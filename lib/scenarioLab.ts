/**
 * Scenario Lab — the data layer behind the Compare tab's "dig into the data."
 *
 * Turns the user's goal + household into a curated set of fully-projected
 * scenarios (the advisor's brokerage-first baseline, the app's recommendation,
 * and meaningful contrasts), exposes their year-by-year rows and summary metrics
 * for on-screen tables and CSV export, and computes the account-mix CROSSOVER:
 * the pre-tax share at which the verdict between two plans flips, so the app can
 * say "Plan B would win if less of your money were in pre-tax — but at your X%, A
 * wins." All deterministic and reproducible; no rounding games.
 *
 * ⚠️ Educational estimates only.
 */

import { Household, bucketOf } from "./accounts";
import { StrategyId, BracketTarget } from "./optimizer";
import { projectLifetime, ProjectionAssumptions, ProjectionResult } from "./projection";

export interface PlanConfig {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  useConversions: boolean;
  convertMode: "recommended" | "fillBracket";
}

export interface Scenario {
  id: string;
  label: string;
  how: string;
  config: PlanConfig;
  projection: ProjectionResult;
}

/** Base lifetime assumptions shared by every scenario (everything except the plan). */
export interface LabAssumptions {
  returnRate: number;
  inflationRate: number;
  endAge: number;
  convertUntilAge: number;
  survivor: { firstDeathAge: number; spendingFactor: number } | null;
  heirTaxRate: number;
  spendingStrategy?: "constant" | "guardrails";
}

function toProjAssumptions(base: LabAssumptions, c: PlanConfig): ProjectionAssumptions {
  return {
    strategy: c.strategy,
    bracketTarget: c.bracketTarget,
    returnRate: base.returnRate,
    inflationRate: base.inflationRate,
    endAge: base.endAge,
    convert: c.useConversions ? { untilAge: base.convertUntilAge, mode: c.convertMode } : null,
    survivor: base.survivor,
    heirTaxRate: base.heirTaxRate,
    spendingStrategy: base.spendingStrategy ?? "constant",
  };
}

export const planAssumptions = toProjAssumptions;

const sig = (c: PlanConfig) =>
  `${c.strategy}|${c.bracketTarget}|${c.useConversions ? c.convertMode : "none"}`;

/**
 * Build the curated comparison set for this household + goal. Always includes:
 *  - the advisor's "brokerage-first, no conversions" baseline (the common claim),
 *  - the app's RECOMMENDED plan (marked by the caller via recommendedConfig),
 *  - a "convert harder" contrast and a withdrawal-order contrast,
 * deduped by config so the recommendation is never shown twice.
 */
export function buildScenarios(
  household: Household,
  base: LabAssumptions,
  recommended: PlanConfig,
): Scenario[] {
  const defs: { id: string; label: string; how: string; config: PlanConfig }[] = [
    {
      id: "advisor",
      label: "Brokerage-first, no conversions",
      how: "Spend taxable (brokerage & cash) first, then pre-tax, Roth last. Never convert. The common rule of thumb.",
      config: { strategy: "conventional", bracketTarget: 0.22, useConversions: false, convertMode: "recommended" },
    },
    {
      id: "recommended",
      label: "Recommended for your goal",
      how: "The plan the app picks for the goal you chose on Start, after testing every withdrawal order × bracket × conversion setting.",
      config: recommended,
    },
    {
      id: "convert-more",
      label: "Convert harder (fill 24%)",
      how: "Same withdrawal order as your recommendation, but aggressively fill the 24% bracket with Roth conversions — moves the most pre-tax into tax-free Roth now.",
      config: { strategy: recommended.strategy, bracketTarget: 0.24, useConversions: true, convertMode: "fillBracket" },
    },
    {
      id: "bracket-fill",
      label: "Pre-tax first (fill 22%)",
      how: "Tax-smart withdrawals: fill the 22% bracket with pre-tax dollars before touching the brokerage. No separate conversions.",
      config: { strategy: "smart", bracketTarget: 0.22, useConversions: false, convertMode: "recommended" },
    },
  ];

  // Dedupe by config signature, keeping the FIRST (so "recommended" wins its label
  // if it equals a contrast). Then ensure the recommended config is present.
  const seen = new Set<string>();
  const out: Scenario[] = [];
  const recSig = sig(recommended);
  for (const d of defs) {
    const s = sig(d.config);
    // If a non-recommended def happens to equal the recommended config, skip it —
    // the dedicated "recommended" entry covers it.
    if (d.id !== "recommended" && s === recSig) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ ...d, projection: projectLifetime(household, toProjAssumptions(base, d.config)) });
  }
  return out;
}

// ─────────────────────────── CSV serialization ───────────────────────────

const csvCell = (v: string | number | boolean): string => {
  const s = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: (string | number | boolean)[]) => cells.map(csvCell).join(",");

/** One row per scenario: the headline metrics, side by side. */
export function summaryCSV(scenarios: Scenario[], endAge: number): string {
  const header = [
    "scenario", "withdrawal_order", "bracket_target", "conversions", "convert_mode",
    "after_tax_estate", "after_tax_estate_today$", "lifetime_tax", "lifetime_tax_today$",
    "lifetime_irmaa", "total_converted_to_roth", "peak_rmd", "peak_marginal_rate",
    `runs_short_before_age_${endAge}`, "solvent_years",
  ];
  const rows = scenarios.map((s) => {
    const p = s.projection;
    return csvRow([
      s.label, s.config.strategy, s.config.bracketTarget,
      s.config.useConversions, s.config.useConversions ? s.config.convertMode : "—",
      Math.round(p.endingEstateAfterTax), Math.round(p.endingEstateAfterTaxReal),
      Math.round(p.lifetimeTax), Math.round(p.lifetimeTaxReal),
      Math.round(p.lifetimeIrmaa), Math.round(p.totalConverted),
      Math.round(p.peakRmd), p.peakMarginalRate, p.depleted, p.solventYears,
    ]);
  });
  return [csvRow(header), ...rows].join("\n");
}

/** Tidy/long format: one row per (scenario, year) — every per-year column, so any
 *  pivot/what-if can be answered in a spreadsheet. */
export function perYearCSV(scenarios: Scenario[]): string {
  const header = [
    "scenario", "year", "self_age", "spouse_age", "rmd",
    "from_pretax", "from_brokerage_cash", "from_roth", "converted_to_roth",
    "magi", "taxable_social_security", "marginal_rate", "true_marginal_rate",
    "total_tax", "irmaa", "net_cash", "spending_target",
    "start_pretax", "start_roth", "start_taxable", "end_total", "shortfall",
  ];
  const rows: string[] = [];
  for (const s of scenarios) {
    for (const r of s.projection.rows) {
      rows.push(csvRow([
        s.label, r.year, r.selfAge, r.spouseAge, Math.round(r.rmd),
        Math.round(r.fromPretax), Math.round(r.fromTaxable), Math.round(r.fromRoth), Math.round(r.conversion),
        Math.round(r.magi), Math.round(r.taxableSS), r.marginalRate, Number(r.effMarginalRate.toFixed(4)),
        Math.round(r.tax), Math.round(r.irmaa), Math.round(r.netCash), Math.round(r.spendingTarget),
        Math.round(r.startBalances.pretax), Math.round(r.startBalances.roth), Math.round(r.startBalances.taxable),
        Math.round(r.endTotal), r.shortfall,
      ]));
    }
  }
  return [csvRow(header), ...rows].join("\n");
}

// ───────────────────────── account-mix crossover ─────────────────────────

export interface Crossover {
  /** Current pre-tax share of total savings (0–1). */
  currentShare: number;
  currentPretax: number;
  total: number;
  /** After-tax estate edge of A over B at the CURRENT mix (today's $). >0 → A wins. */
  edgeNow: number;
  /** Pre-tax share where A and B tie (null if A wins across the whole 0–current range,
   *  i.e. no flip — A wins regardless of mix). */
  crossoverShare: number | null;
  /** Which plan the lower-pre-tax region favors ("A" or "B"). */
  favorsWhenLower: "A" | "B";
}

/** Move `frac` of the pre-tax balance into the brokerage (fresh basis), holding total
 *  constant — an illustration of "what if more of your money sat in taxable, not pre-tax." */
function withPretaxShare(household: Household, targetPretax: number): Household {
  const accounts = household.accounts.map((a) => ({ ...a }));
  const pretaxAccts = accounts.filter((a) => bucketOf(a.kind) === "pretax");
  const curPretax = pretaxAccts.reduce((s, a) => s + a.balance, 0);
  if (curPretax <= 0) return { ...household, accounts };
  const scale = Math.max(0, Math.min(1, targetPretax / curPretax));
  let moved = 0;
  for (const a of pretaxAccts) {
    const keep = a.balance * scale;
    moved += a.balance - keep;
    a.balance = keep;
    if (a.holdings) a.holdings = a.holdings.map((h) => ({ ...h, shares: h.shares * scale }));
  }
  // Drop the freed dollars into a fresh brokerage lot (basis = balance → no embedded gain).
  if (moved > 0) {
    const brk = accounts.find((a) => a.kind === "brokerage");
    if (brk) {
      brk.balance += moved;
      brk.costBasis = (brk.costBasis ?? 0) + moved;
      if (brk.holdings) brk.holdings = undefined; // balance-based after the synthetic shift
    } else {
      accounts.push({ id: "xover-brk", label: "Brokerage (what-if)", kind: "brokerage", owner: "self", balance: moved, costBasis: moved });
    }
  }
  return { ...household, accounts };
}

/**
 * Find the pre-tax share at which plan A and plan B tie on after-tax estate, by
 * scanning lower pre-tax shares (holding total wealth constant). Deterministic.
 */
export function findPretaxCrossover(
  household: Household,
  base: LabAssumptions,
  configA: PlanConfig,
  configB: PlanConfig,
): Crossover {
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const currentPretax = household.accounts
    .filter((a) => bucketOf(a.kind) === "pretax")
    .reduce((s, a) => s + a.balance, 0);
  const currentShare = total > 0 ? currentPretax / total : 0;

  const edgeAt = (pretax: number): number => {
    const h = withPretaxShare(household, pretax);
    const a = projectLifetime(h, toProjAssumptions(base, configA)).endingEstateAfterTaxReal;
    const b = projectLifetime(h, toProjAssumptions(base, configB)).endingEstateAfterTaxReal;
    return a - b;
  };

  const edgeNow = edgeAt(currentPretax);
  // Scan from the current pre-tax DOWN to ~0, looking for a sign flip in (A − B).
  const STEPS = 12;
  let prevShare = currentShare;
  let prevEdge = edgeNow;
  let crossoverShare: number | null = null;
  for (let i = 1; i <= STEPS; i++) {
    const share = currentShare * (1 - i / STEPS);
    const pretax = share * total;
    const edge = edgeAt(pretax);
    if ((prevEdge > 0 && edge <= 0) || (prevEdge < 0 && edge >= 0)) {
      // linear-interpolate the zero crossing between prevShare and share
      const t = prevEdge / (prevEdge - edge);
      crossoverShare = prevShare + t * (share - prevShare);
      break;
    }
    prevShare = share;
    prevEdge = edge;
  }
  return {
    currentShare,
    currentPretax,
    total,
    edgeNow,
    crossoverShare,
    favorsWhenLower: prevEdge < 0 ? "B" : edgeNow < 0 ? "A" : "B",
  };
}
