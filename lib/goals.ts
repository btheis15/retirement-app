/**
 * Goal-based robo-advisor.
 *
 * The user picks WHAT they want (most after-tax money, lowest total tax, or the
 * lowest/smoothest tax rate). This module turns that goal into a concrete PLAN by
 * simulating a grid of candidate configurations — withdrawal order × bracket
 * ceiling × with/without Roth conversions — over the full lifetime, scoring each
 * against the goal, and returning the winner plus a plain-English rationale.
 *
 * This is the "advice" layer: every other page just renders the plan it picks.
 *
 * ⚠️ Educational estimates only — not tax advice.
 */

import { Household } from "./accounts";
import { BracketTarget, StrategyId } from "./optimizer";
import { projectLifetime, ProjectionResult } from "./projection";
import { fullRetirementAge } from "./socialSecurity";
import { GoalId } from "./defaults";
import { money, percent } from "./format";

export const GOAL_META: Record<GoalId, { label: string; short: string; blurb: string; icon: string }> = {
  maxCapital: {
    label: "Maximum capital",
    short: "Most money left",
    blurb:
      "End up with the biggest pile after all taxes — to enjoy or pass on. Pays a little tax now only when that grows what you ultimately keep. Best for most people.",
    icon: "💰",
  },
  lowestTax: {
    label: "Lowest total tax",
    short: "Smallest tax bill",
    blurb:
      "Pay the least total tax over your lifetime. Simple and satisfying — but the smallest tax bill isn't always the most money kept.",
    icon: "🧾",
  },
  lowestRate: {
    label: "Lowest tax rate",
    short: "Low & steady rate",
    blurb:
      "Keep your tax rate low and even year to year — no sudden spikes that raise your taxes or Medicare costs. Lowest average rate, not necessarily the most money.",
    icon: "📉",
  },
};

export interface PlanConfig {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  useConversions: boolean;
  /** Conversion sizing when useConversions: rate-arbitrage or fill-the-bracket. */
  convertMode: "recommended" | "fillBracket";
}

export interface PlanInputs {
  returnRate: number;
  inflationRate: number;
  endAge: number;
  convertUntilAge: number;
  /** Survivor (widow's-penalty) assumption, or null to disable. */
  survivor?: { firstDeathAge: number; spendingFactor: number } | null;
  /** Heir's assumed marginal rate on inherited pre-tax (10-year rule). Default 0.24. */
  heirTaxRate?: number;
  /** Dividends/interest reinvested (default) or spent — passed through to the engine. */
  dividendMode?: "reinvest" | "spend";
}

export interface PlanMetrics {
  netWealth: number; // after-tax estate at endAge (full step-up — the displayed "money you keep")
  /** Same estate if the brokerage step-up does NOT apply (all unrealized gain taxed
   *  at LTCG). Used to break near-ties toward the plan least dependent on the
   *  fragile, all-or-nothing step-up assumption — so we don't recommend a plan that
   *  only "wins" by hoarding a gain-laden brokerage. */
  netWealthRobust: number;
  lifetimeTax: number;
  taxPct: number; // lifetime tax / lifetime gross income
  peakRmd: number;
  lifetimeIrmaa: number;
  totalConverted: number;
  depleted: boolean;
  /** Years funded before the first shortfall (orders failing plans by longevity). */
  solventYears: number;
}

/** LTCG rate used to value the unrealized brokerage gain when step-up is assumed
 *  NOT to apply (the robustness yardstick). A mid 15% bracket. */
export const ROBUST_LTCG_RATE = 0.15;

export interface Candidate {
  config: PlanConfig;
  label: string;
  projection: ProjectionResult;
  metrics: PlanMetrics;
}

/** Optimal Social Security claim ages for this household + goal, and the lifetime
 *  value vs. the ages currently entered. Surfaced as guidance (not auto-applied —
 *  when to claim is a major personal decision). Conditioned on the household's own
 *  longevity (endAge): at a short horizon delaying loses, so the search picks the
 *  earlier claim. null when there's no SS or no meaningful improvement. */
export interface ClaimAdvice {
  self: number;
  spouse: number;
  currentSelf: number;
  currentSpouse: number;
  /** Goal-metric improvement of the recommended ages vs. the current ages. */
  lift: number;
  /** Which spouse the advice asks to delay (for the headline), or null. */
  delayWho: "self" | "spouse" | "both" | null;
}

export interface Recommendation {
  goal: GoalId;
  best: Candidate;
  /** All candidates, ranked best-first for this goal. */
  ranked: Candidate[];
  /** One-line, plain-English reason this plan wins for the goal. */
  rationale: string;
  /** Conversion window end-age the search settled on (so the UI can preselect it). */
  chosenConvertUntilAge: number;
  /** Social Security claim-age guidance, or null when it doesn't move the needle. */
  claimAdvice: ClaimAdvice | null;
}

export interface RecommendOptions {
  /** Search the conversion-window end-age (default true). */
  searchWindow?: boolean;
  /** Search Social Security claim ages (default true). The heaviest step; turn off
   *  for the lightweight per-goal previews. */
  optimizeClaimAge?: boolean;
}

// The robo-advisor searches the FULL realistic decision space and lets the numbers
// pick the winner per goal. The earlier grid quietly omitted whole levers, each of
// which is the true optimum on some households (all verified against the engine):
//   • withdrawal ORDER — conventional (spend the brokerage first), smart (fill low
//     brackets with pre-tax first), AND proportional (draw pro-rata). The order
//     interacts strongly with conversions: spending the brokerage first keeps
//     ordinary income low, freeing more low-bracket room to convert cheaply, and
//     the brokerage's gains get a step-up at death.
//   • bracket CEILING for conversions — {12,22,24,32}. For big pre-tax balances,
//     converting up into 32% during the window beats the 35%+ RMDs it later forces.
//   • conversion MODE — "recommended" (rate-arbitrage) AND "fillBracket" (pack the
//     bracket); fillBracket is the true optimum for several households on the
//     tax-minimizing goals and even maxCapital in a few cases.
// Omitting any of these handed out plans that leave real money on the table. The
// step-up robustness tie-break in recommendPlan keeps the grid from chasing a
// "win" that depends entirely on a fragile full-step-up bet.
const STRATEGIES: StrategyId[] = ["conventional", "smart", "proportional"];
const CONV_BRACKETS: BracketTarget[] = [0.12, 0.22, 0.24, 0.32];

const ORDER_LABEL: Record<StrategyId, string> = {
  conventional: "Brokerage-first",
  smart: "Bracket-fill (pre-tax first)",
  proportional: "Proportional draw",
};

function buildConfigs(): { config: PlanConfig; label: string }[] {
  const out: { config: PlanConfig; label: string }[] = [];
  for (const strategy of STRATEGIES) {
    // No-conversion baselines. bracketTarget only changes the WITHDRAWAL order for
    // "smart" (fill-to-N), so smart gets all ceilings; the others get one.
    const noConvBrackets: BracketTarget[] = strategy === "smart" ? CONV_BRACKETS : [0.22];
    for (const bracketTarget of noConvBrackets) {
      out.push({
        config: { strategy, bracketTarget, useConversions: false, convertMode: "recommended" },
        label: `${ORDER_LABEL[strategy]}${strategy === "smart" ? ` to ${Math.round(bracketTarget * 100)}%` : ""} — no conversions`,
      });
    }
    // With conversions: every ceiling × both sizing modes.
    for (const bracketTarget of CONV_BRACKETS) {
      for (const convertMode of ["recommended", "fillBracket"] as const) {
        out.push({
          config: { strategy, bracketTarget, useConversions: true, convertMode },
          label: `${ORDER_LABEL[strategy]} + ${convertMode === "recommended" ? "rate-smart" : "bracket-fill"} Roth conversions to ${Math.round(bracketTarget * 100)}%`,
        });
      }
    }
  }
  return out;
}

const CONFIGS: { config: PlanConfig; label: string }[] = buildConfigs();

function evaluateConfig(household: Household, inputs: PlanInputs, c: { config: PlanConfig; label: string }): Candidate {
  const projection = projectLifetime(household, {
    strategy: c.config.strategy,
    bracketTarget: c.config.bracketTarget,
    returnRate: inputs.returnRate,
    inflationRate: inputs.inflationRate,
    endAge: inputs.endAge,
    convert: c.config.useConversions ? { untilAge: inputs.convertUntilAge, mode: c.config.convertMode } : null,
    survivor: inputs.survivor ?? null,
    heirTaxRate: inputs.heirTaxRate,
    dividendMode: inputs.dividendMode,
  });
  // Lifetime gross income base for the tax-rate metric. Include CONVERSION income:
  // its tax is in `r.tax`, so leaving the converted dollars out of the denominator
  // made converting plans' rates incomparable with non-converting plans' rates.
  const grossIncome = projection.rows.reduce((s, r) => s + r.netCash + r.tax + r.conversion, 0);
  const lifetimeIrmaa = projection.rows.reduce((s, r) => s + r.irmaa, 0);
  return {
    config: c.config,
    label: c.label,
    projection,
    metrics: {
      netWealth: projection.endingEstateAfterTax,
      netWealthRobust: Math.max(0, projection.endingEstateAfterTax - projection.endingBuckets.taxableGain * ROBUST_LTCG_RATE),
      lifetimeTax: projection.lifetimeTax,
      taxPct: grossIncome > 0 ? projection.lifetimeTax / grossIncome : 0,
      peakRmd: projection.peakRmd,
      lifetimeIrmaa,
      totalConverted: projection.totalConverted,
      depleted: projection.depleted,
      solventYears: projection.solventYears,
    },
  };
}

/** Goal score — higher is better. A depleted plan is always worse than any plan
 *  that funds spending to the end; among depleted plans, the one that lasts longest
 *  ranks higher (so the user sees the failing plan that buys the most time, and a
 *  near-miss isn't treated the same as a plan that runs dry a decade early). */
function score(goal: GoalId, m: PlanMetrics): number {
  if (m.depleted) return -1e12 + m.solventYears; // all failing plans below any solvent one
  switch (goal) {
    case "maxCapital":
      return m.netWealth;
    case "lowestTax":
      return -m.lifetimeTax;
    case "lowestRate":
      // primarily the effective rate; gently prefer lower IRMAA on ties
      return -(m.taxPct * 1e9 + m.lifetimeIrmaa);
  }
}

/** Sort candidates for a goal and apply the maxCapital step-up robustness tie-break
 *  (recommend the most-step-up-robust plan among those within ~2% on full-step-up
 *  wealth, so we don't steer the user onto a fragile brokerage-hoarding bet). */
function rankCandidates(candidates: Candidate[], goal: GoalId): Candidate[] {
  const ranked = [...candidates].sort((a, b) => score(goal, b.metrics) - score(goal, a.metrics));
  if (goal === "maxCapital" && ranked.length > 1 && !ranked[0].metrics.depleted) {
    const band = ranked[0].metrics.netWealth * 0.02;
    const contenders = ranked.filter(
      (c) => !c.metrics.depleted && ranked[0].metrics.netWealth - c.metrics.netWealth <= band,
    );
    if (contenders.length > 1) {
      contenders.sort((a, b) => b.metrics.netWealthRobust - a.metrics.netWealthRobust);
      const winner = contenders[0];
      if (winner !== ranked[0]) {
        ranked.splice(ranked.indexOf(winner), 1);
        ranked.unshift(winner);
      }
    }
  }
  return ranked;
}

const uniqNums = (xs: number[]) => [...new Set(xs)];

export function recommendPlan(
  household: Household,
  inputs: PlanInputs,
  goal: GoalId,
  opts: RecommendOptions = {},
): Recommendation {
  const searchWindow = opts.searchWindow ?? true;
  const optimizeClaimAge = opts.optimizeClaimAge ?? true;
  const isSingle = !(household.spouse && household.spouse.birthYear > 1900);

  // Stage 1 — pick the best withdrawal/conversion config at the entered settings.
  const ranked = rankCandidates(CONFIGS.map((c) => evaluateConfig(household, inputs, c)), goal);
  let best = ranked[0];
  let chosenConvertUntilAge = inputs.convertUntilAge;

  // Stage 2 — conversion-window end-age search on the WINNING config (the lever is
  // entangled with strategy, so we search it only after strategy is chosen). The
  // candidate set includes the current window, so this can only improve the goal —
  // never regress. The biggest win is for households entered already near/past 75,
  // whose conversions the fixed default would otherwise cut off.
  if (searchWindow && best.config.useConversions) {
    const selfAgeNow = new Date().getFullYear() - household.self.birthYear;
    const firstDeath = inputs.survivor?.firstDeathAge;
    // Candidates on BOTH sides of the entered window — a shorter window is often
    // better (e.g. stop before SS + RMDs stack up), and the old `>= convertUntilAge`
    // filter could only ever LENGTHEN it, leaving money on the table. The entered
    // window is always in the set, so the search still can't regress the goal.
    const windowSet = uniqNums(
      [inputs.convertUntilAge, 68, 70, 73, 75, 80, firstDeath ? firstDeath - 1 : 0].filter(
        (a) => a >= selfAgeNow && a <= inputs.endAge,
      ),
    );
    let bestScore = score(goal, best.metrics);
    for (const w of windowSet) {
      if (w === inputs.convertUntilAge) continue;
      const cand = evaluateConfig(household, { ...inputs, convertUntilAge: w }, best);
      const s = score(goal, cand.metrics);
      if (s > bestScore + 1) {
        bestScore = s;
        best = cand;
        chosenConvertUntilAge = w;
      }
    }
  }

  // Stage 3 — Social Security claim-age guidance. The engine models claiming
  // accurately but never optimized it; this is the highest-value lever. We score
  // each (self, spouse) claim pair with the SAME goal score, on the chosen config +
  // window. Because the score runs the projection to the household's own endAge,
  // longevity is baked in automatically: at a short horizon, delaying scores worse
  // and we recommend claiming earlier. Surfaced as guidance, not auto-applied.
  const hasSS = household.self.socialSecurityAnnual > 0 || (!isSingle && household.spouse.socialSecurityAnnual > 0);
  let claimAdvice: ClaimAdvice | null = null;
  if (optimizeClaimAge && hasSS) {
    const claimAges = (birthYear: number, current: number) =>
      uniqNums([62, Math.round(fullRetirementAge(birthYear)), 70, current].filter((a) => a >= 62 && a <= 70));
    const selfAges = household.self.socialSecurityAnnual > 0 ? claimAges(household.self.birthYear, household.self.ssClaimAge) : [household.self.ssClaimAge];
    const spouseAges =
      !isSingle && household.spouse.socialSecurityAnnual > 0
        ? claimAges(household.spouse.birthYear, household.spouse.ssClaimAge)
        : [household.spouse.ssClaimAge];

    const claimInputs = { ...inputs, convertUntilAge: chosenConvertUntilAge };
    const evalClaim = (sa: number, pa: number) =>
      evaluateConfig(
        { ...household, self: { ...household.self, ssClaimAge: sa }, spouse: { ...household.spouse, ssClaimAge: pa } },
        claimInputs,
        best,
      );
    const current = evalClaim(household.self.ssClaimAge, household.spouse.ssClaimAge);
    let bestClaim = { sa: household.self.ssClaimAge, pa: household.spouse.ssClaimAge, cand: current, s: score(goal, current.metrics) };
    for (const sa of selfAges) {
      for (const pa of spouseAges) {
        const cand = evalClaim(sa, pa);
        const s = score(goal, cand.metrics);
        if (s > bestClaim.s + 1) bestClaim = { sa, pa, cand, s };
      }
    }
    const lift = bestClaim.cand.metrics.netWealth - current.metrics.netWealth; // tangible "more money" headline
    const changed = bestClaim.sa !== household.self.ssClaimAge || bestClaim.pa !== household.spouse.ssClaimAge;
    if (changed && lift > 10_000) {
      const ds = bestClaim.sa > household.self.ssClaimAge;
      const dp = !isSingle && bestClaim.pa > household.spouse.ssClaimAge;
      claimAdvice = {
        self: bestClaim.sa,
        spouse: bestClaim.pa,
        currentSelf: household.self.ssClaimAge,
        currentSpouse: household.spouse.ssClaimAge,
        lift,
        delayWho: ds && dp ? "both" : ds ? "self" : dp ? "spouse" : null,
      };
    }
  }

  return {
    goal,
    best,
    ranked,
    rationale: buildRationale(goal, best, ranked),
    chosenConvertUntilAge,
    claimAdvice,
  };
}

function buildRationale(goal: GoalId, best: Candidate, ranked: Candidate[]): string {
  // Every candidate failed to fund spending for the full horizon — say so plainly
  // instead of presenting a (now $0) estate as "the most money."
  if (best.metrics.depleted) {
    const rows = best.projection.rows;
    const lastFunded = rows[Math.max(0, best.projection.solventYears - 1)];
    const depleteAge = lastFunded ? lastFunded.selfAge + 1 : undefined;
    return `No plan we tested funds this spending for your whole horizon — even the best one runs short${
      depleteAge ? ` around age ${depleteAge}` : ""
    }. Lower your spending, delay it, or revisit your assumptions; this is the plan that lasts the longest.`;
  }
  const conv = best.config.useConversions;
  const noConvBest = ranked.find((c) => !c.config.useConversions);
  switch (goal) {
    case "maxCapital": {
      const lift =
        conv && noConvBest ? best.metrics.netWealth - noConvBest.metrics.netWealth : 0;
      return conv
        ? `Rolling pre-tax → Roth in your low-tax years leaves about ${money(
            Math.max(0, lift),
          )} more after-tax money and shrinks the forced-RMD peak to ${money(best.metrics.peakRmd)}.`
        : `${best.label} ends with the most after-tax money (${money(best.metrics.netWealth)}) at these assumptions.`;
    }
    case "lowestTax":
      return `${best.label} produces the smallest lifetime federal tax bill (${money(
        best.metrics.lifetimeTax,
      )}). Note: this isn't always the most money kept — compare against Maximum capital.`;
    case "lowestRate":
      // Report the ACTUAL lifetime IRMAA rather than only crediting "avoids IRMAA"
      // when it's exactly zero (it rarely is) — don't promise what the plan doesn't do.
      return `${best.label} keeps your lifetime effective tax rate lowest (${percent(best.metrics.taxPct)})${
        best.metrics.lifetimeIrmaa > 0
          ? `, with about ${money(best.metrics.lifetimeIrmaa)} of lifetime Medicare (IRMAA) surcharges along the way`
          : " and avoids Medicare IRMAA surcharges entirely"
      }.`;
  }
}

/** Ultra-short, jargon-free gist of what a plan actually DOES — for goal-compare
 *  hints and at-a-glance summaries. (describePlan is the fuller, more technical
 *  one-liner.) */
export function planGist(config: PlanConfig): string {
  const order =
    config.strategy === "conventional"
      ? "Spend the brokerage first"
      : config.strategy === "proportional"
        ? "Draw from every account proportionally"
        : "Tax-smart withdrawals (low brackets first)";
  if (!config.useConversions) return `${order} — no Roth conversions`;
  return `${order}, rolling pre-tax → Roth up to the ${Math.round(config.bracketTarget * 100)}% bracket`;
}

/** Human description of a resolved plan, e.g. for a "your plan" summary line. */
export function describePlan(config: PlanConfig, convertUntilAge: number): string {
  const base =
    config.strategy === "smart"
      ? `Smart bracket-fill to ${Math.round(config.bracketTarget * 100)}%`
      : config.strategy === "conventional"
        ? "Brokerage-first — conventional (taxable → pre-tax → Roth)"
        : "Proportional";
  if (!config.useConversions) return base;
  const conv = config.convertMode === "recommended" ? "recommended Roth conversions" : "bracket-fill Roth conversions";
  return `${base}, with ${conv} through age ${convertUntilAge}`;
}

/** Does the user's current manual settings match a goal's recommended config? */
export function configMatches(a: PlanConfig, b: PlanConfig): boolean {
  if (a.strategy !== b.strategy) return false;
  // bracketTarget is meaningful in two cases: it's the fill-to ceiling for the
  // "smart" withdrawal order, AND it's the conversion ceiling whenever conversions
  // are on (the "to N%" in plan labels). Compare it in either case — otherwise
  // plans that differ only by conversion bracket all read as the same active plan.
  if ((a.strategy === "smart" || a.useConversions) && a.bracketTarget !== b.bracketTarget) return false;
  if (a.useConversions !== b.useConversions) return false;
  if (a.useConversions && a.convertMode !== b.convertMode) return false;
  return true;
}
