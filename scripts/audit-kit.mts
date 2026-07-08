/**
 * Shared analysis kit for the financial-engine audit. Gives every auditor the SAME
 * household archetypes, default inputs, and helpers so findings are comparable and
 * reproducible. Import from a probe file in scripts/:  import * as K from "./audit-kit.mts";
 *
 * Run a probe:  cd /Users/brian/retirement-app && npx tsx scripts/_audit_<name>.mts
 */

import { projectLifetime } from "../lib/projection.ts";
import { recommendPlan } from "../lib/goals.ts";
import { planYear, computeRmd } from "../lib/optimizer.ts";
import { computeTaxes } from "../lib/tax/engine.ts";
import { DEMO_HOUSEHOLD } from "../lib/demo.ts";
import { adjustedAnnualBenefit } from "../lib/socialSecurity.ts";

export { projectLifetime, recommendPlan, planYear, computeRmd, computeTaxes, DEMO_HOUSEHOLD, adjustedAnnualBenefit };

// ---- formatting ----
export const fmt = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
export const pct = (n, d = 1) => (n * 100).toFixed(d) + "%";

// ---- default planner inputs (mirror DEFAULT_SETTINGS) ----
export const DEFAULT_INPUTS = {
  returnRate: 0.05,
  inflationRate: 0.025,
  endAge: 95,
  convertUntilAge: 75,
  survivor: { firstDeathAge: 85, spendingFactor: 0.8 },
  heirTaxRate: 0.24,
};

// Build ProjectionAssumptions from a compact config + inputs.
export function toAssumptions(config, inputs = DEFAULT_INPUTS, over = {}) {
  return {
    strategy: config.strategy,
    bracketTarget: config.bracketTarget,
    returnRate: inputs.returnRate,
    inflationRate: inputs.inflationRate,
    endAge: inputs.endAge,
    convert: config.conv ? { untilAge: inputs.convertUntilAge, mode: config.convMode ?? "recommended" } : null,
    survivor: inputs.survivor ?? null,
    heirTaxRate: inputs.heirTaxRate,
    spendingStrategy: config.spendingStrategy ?? "constant",
    ...over,
  };
}

// ---- household archetypes ----
const scale = (hh, f, patch = {}) => ({
  ...hh,
  ...patch,
  self: { ...hh.self, ...(patch.self ?? {}) },
  spouse: { ...hh.spouse, ...(patch.spouse ?? {}) },
  accounts: hh.accounts.map((a) => ({
    ...a,
    balance: a.balance * f,
    costBasis: a.costBasis != null ? a.costBasis * f : undefined,
    holdings: undefined, // balances already synced; drop holdings for probe speed
  })),
});

// Re-mix the account buckets to a target (pretax / roth / taxable) share of total,
// keeping total and the brokerage's gain fraction roughly intact.
function remix(hh, target) {
  const total = hh.accounts.reduce((s, a) => s + a.balance, 0);
  const want = { pretax: total * target.pretax, roth: total * target.roth, taxable: total * target.taxable };
  // collapse to 3 representative accounts
  return {
    ...hh,
    accounts: [
      { id: "pre", label: "Pre-tax", kind: "traditional_ira", owner: "self", balance: want.pretax },
      { id: "rth", label: "Roth", kind: "roth_ira", owner: "self", balance: want.roth },
      { id: "brk", label: "Brokerage", kind: "brokerage", owner: "self", balance: want.taxable * 0.8, costBasis: want.taxable * 0.8 * 0.5 },
      { id: "csh", label: "Cash", kind: "cash", owner: "self", balance: want.taxable * 0.2, costBasis: want.taxable * 0.2 },
    ].filter((a) => a.balance > 0),
  };
}

/** A labeled set of realistic households spanning the decision space. */
export function archetypes() {
  const D = DEMO_HOUSEHOLD;
  return [
    { label: "Demo $5M / $180k (MFJ, SS@67)", hh: D },
    { label: "Demo low spend $90k", hh: { ...D, annualSpending: 90_000 } },
    { label: "Demo high spend $280k", hh: { ...D, annualSpending: 280_000 } },
    { label: "Small $875k / $70k", hh: scale(D, 0.175, { annualSpending: 70_000 }) },
    { label: "Modest $1.75M / $120k", hh: scale(D, 0.35, { annualSpending: 120_000 }) },
    { label: "Large $12M / $320k", hh: scale(D, 2.4, { annualSpending: 320_000 }) },
    { label: "Ultra $30M / $600k", hh: scale(D, 6, { annualSpending: 600_000 }) },
    { label: "Pre-65 early retiree (60/58), $4M / $160k", hh: { ...scale(D, 0.8), self: { ...D.self, birthYear: 1966, ssClaimAge: 70 }, spouse: { ...D.spouse, birthYear: 1968, ssClaimAge: 70 }, annualSpending: 160_000 } },
    { label: "Mostly pre-tax (80/10/10) $5M / $180k", hh: remix(D, { pretax: 0.8, roth: 0.1, taxable: 0.1 }) },
    { label: "Mostly taxable (20/10/70) $5M / $180k", hh: remix(D, { pretax: 0.2, roth: 0.1, taxable: 0.7 }) },
    { label: "Roth-heavy (30/50/20) $5M / $180k", hh: remix(D, { pretax: 0.3, roth: 0.5, taxable: 0.2 }) },
    { label: "Single filer $3M / $120k (one person)", hh: { ...scale(D, 0.6), spouse: { ...D.spouse, socialSecurityAnnual: 0, birthYear: 1900 }, annualSpending: 120_000 } },
    { label: "Big pension $5M / $200k (pension $80k)", hh: { ...D, pensionAnnual: 80_000, annualSpending: 200_000 } },
  ];
}

// ---- exhaustive "true optimum" search over the withdrawal/conversion space ----
// Far larger than the shipped grid, so it reveals what the advisor SHOULD pick.
export function configSpace() {
  const out = [];
  const strategies = ["conventional", "smart", "proportional"];
  const brackets = [0.12, 0.22, 0.24, 0.32];
  for (const strategy of strategies) {
    // no conversion (bracketTarget only matters for smart withdrawals)
    const noConvBrackets = strategy === "smart" ? brackets : [0.22];
    for (const bracketTarget of noConvBrackets) out.push({ strategy, bracketTarget, conv: false });
    // with conversion (recommended + fillBracket), bracketTarget caps the fill
    for (const bracketTarget of brackets) {
      out.push({ strategy, bracketTarget, conv: true, convMode: "recommended" });
      out.push({ strategy, bracketTarget, conv: true, convMode: "fillBracket" });
    }
  }
  return out;
}

export function grossIncome(p) {
  // Mirrors lib/goals.ts: conversion income IS in the denominator (its tax is in
  // the numerator), so converting and non-converting plans' rates are comparable.
  return p.rows.reduce((s, r) => s + r.netCash + r.tax + r.conversion, 0);
}

/** Score a projection for a goal (higher = better), matching lib/goals.ts semantics. */
export function scoreFor(goal, p) {
  const depletion = p.depleted ? 1e12 : 0;
  if (goal === "maxCapital") return p.endingEstateAfterTax - depletion;
  if (goal === "lowestTax") return -p.lifetimeTax - depletion;
  // lowestRate
  const gi = grossIncome(p);
  const taxPct = gi > 0 ? p.lifetimeTax / gi : 0;
  return -(taxPct * 1e9 + p.lifetimeIrmaa) - depletion;
}

/** Brute-force the best config in the FULL space for a goal. Returns {config, p, score, all}. */
export function exhaustiveBest(hh, goal, inputs = DEFAULT_INPUTS) {
  const all = configSpace().map((c) => {
    const p = projectLifetime(hh, toAssumptions(c, inputs));
    return { config: c, p, score: scoreFor(goal, p) };
  });
  all.sort((a, b) => b.score - a.score);
  return { best: all[0], all };
}

/** What the SHIPPED advisor recommends for a goal. */
export function shippedBest(hh, goal, inputs = DEFAULT_INPUTS) {
  const rec = recommendPlan(hh, inputs, goal);
  return rec;
}
