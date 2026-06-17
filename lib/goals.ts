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
}

export interface PlanMetrics {
  netWealth: number; // after-tax estate at endAge
  lifetimeTax: number;
  taxPct: number; // lifetime tax / lifetime gross income
  peakRmd: number;
  lifetimeIrmaa: number;
  totalConverted: number;
  depleted: boolean;
}

export interface Candidate {
  config: PlanConfig;
  label: string;
  projection: ProjectionResult;
  metrics: PlanMetrics;
}

export interface Recommendation {
  goal: GoalId;
  best: Candidate;
  /** All candidates, ranked best-first for this goal. */
  ranked: Candidate[];
  /** One-line, plain-English reason this plan wins for the goal. */
  rationale: string;
}

// The robo-advisor chooses among NO conversions and RECOMMENDED (rate-arbitrage)
// conversions. "Fill the bracket" is intentionally NOT a goal candidate — it's a
// manual advanced override the user can pick on the Plan/Compare pages — so the
// recommended approach stays the default guidance.
const CONFIGS: { config: PlanConfig; label: string }[] = [
  { config: { strategy: "conventional", bracketTarget: 0.22, useConversions: false, convertMode: "recommended" }, label: "Conventional order" },
  { config: { strategy: "smart", bracketTarget: 0.12, useConversions: false, convertMode: "recommended" }, label: "Smart — fill to 12%" },
  { config: { strategy: "smart", bracketTarget: 0.22, useConversions: false, convertMode: "recommended" }, label: "Smart — fill to 22%" },
  { config: { strategy: "smart", bracketTarget: 0.24, useConversions: false, convertMode: "recommended" }, label: "Smart — fill to 24%" },
  { config: { strategy: "smart", bracketTarget: 0.12, useConversions: true, convertMode: "recommended" }, label: "Smart (12% spend) + recommended Roth conversions" },
  { config: { strategy: "smart", bracketTarget: 0.22, useConversions: true, convertMode: "recommended" }, label: "Smart + recommended Roth conversions" },
  { config: { strategy: "smart", bracketTarget: 0.24, useConversions: true, convertMode: "recommended" }, label: "Smart (24% spend) + recommended Roth conversions" },
];

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
  });
  const grossIncome = projection.rows.reduce((s, r) => s + r.netCash + r.tax, 0);
  const lifetimeIrmaa = projection.rows.reduce((s, r) => s + r.irmaa, 0);
  return {
    config: c.config,
    label: c.label,
    projection,
    metrics: {
      netWealth: projection.endingEstateAfterTax,
      lifetimeTax: projection.lifetimeTax,
      taxPct: grossIncome > 0 ? projection.lifetimeTax / grossIncome : 0,
      peakRmd: projection.peakRmd,
      lifetimeIrmaa,
      totalConverted: projection.totalConverted,
      depleted: projection.depleted,
    },
  };
}

/** Goal score — higher is better. Depleted plans are pushed to the bottom. */
function score(goal: GoalId, m: PlanMetrics): number {
  const depletionPenalty = m.depleted ? 1e12 : 0;
  switch (goal) {
    case "maxCapital":
      return m.netWealth - depletionPenalty;
    case "lowestTax":
      return -m.lifetimeTax - depletionPenalty;
    case "lowestRate":
      // primarily the effective rate; gently prefer lower IRMAA on ties
      return -(m.taxPct * 1e9 + m.lifetimeIrmaa) - depletionPenalty;
  }
}

export function recommendPlan(household: Household, inputs: PlanInputs, goal: GoalId): Recommendation {
  const candidates = CONFIGS.map((c) => evaluateConfig(household, inputs, c));
  const ranked = [...candidates].sort((a, b) => score(goal, b.metrics) - score(goal, a.metrics));
  const best = ranked[0];

  return { goal, best, ranked, rationale: buildRationale(goal, best, ranked) };
}

function buildRationale(goal: GoalId, best: Candidate, ranked: Candidate[]): string {
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
      return `${best.label} keeps your lifetime effective tax rate lowest (${percent(
        best.metrics.taxPct,
      )})${best.metrics.lifetimeIrmaa > 0 ? "" : " and avoids Medicare IRMAA surcharges"}.`;
  }
}

/** Ultra-short, jargon-free gist of what a plan actually DOES — for goal-compare
 *  hints and at-a-glance summaries. (describePlan is the fuller, more technical
 *  one-liner.) */
export function planGist(config: PlanConfig): string {
  if (!config.useConversions) return "No Roth conversions — just tax-smart withdrawals";
  return `Roll some pre-tax → Roth each year, up to the ${Math.round(config.bracketTarget * 100)}% bracket`;
}

/** Human description of a resolved plan, e.g. for a "your plan" summary line. */
export function describePlan(config: PlanConfig, convertUntilAge: number): string {
  const base =
    config.strategy === "smart"
      ? `Smart bracket-fill to ${Math.round(config.bracketTarget * 100)}%`
      : config.strategy === "conventional"
        ? "Conventional order (taxable → pre-tax → Roth)"
        : "Proportional";
  if (!config.useConversions) return base;
  const conv = config.convertMode === "recommended" ? "recommended Roth conversions" : "bracket-fill Roth conversions";
  return `${base}, with ${conv} through age ${convertUntilAge}`;
}

/** Does the user's current manual settings match a goal's recommended config? */
export function configMatches(a: PlanConfig, b: PlanConfig): boolean {
  if (a.strategy !== b.strategy) return false;
  if (a.strategy === "smart" && a.bracketTarget !== b.bracketTarget) return false;
  if (a.useConversions !== b.useConversions) return false;
  if (a.useConversions && a.convertMode !== b.convertMode) return false;
  return true;
}
