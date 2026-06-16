/**
 * Withdrawal optimizer — the core of the app.
 *
 * Given a household's accounts, ages, fixed income (Social Security + pension),
 * and a target spending level, it decides WHICH accounts to pull from and HOW
 * MUCH, to cover spending while paying as little federal tax as possible — and
 * it always satisfies Required Minimum Distributions (RMDs) first.
 *
 * Key tax-law facts baked in:
 *  - RMDs apply ONLY to pre-tax accounts (Traditional IRA / 401k / rollover),
 *    starting at age 73 or 75 depending on birth year (SECURE 2.0). Roth IRAs
 *    have NO lifetime RMDs for the owner — a common misconception is that they
 *    do. So you are never *forced* to drain your Roth.
 *  - Pulling pre-tax money is ordinary income and can also make more of your
 *    Social Security taxable and push capital gains out of the 0% bracket — the
 *    engine accounts for all of that together.
 *
 * ⚠️ Educational estimates only — not tax advice.
 */

import { computeTaxes, ordinaryBracketCeiling, TaxResult } from "./tax/engine";
import { rmdStartAge, uniformLifetimeFactor } from "./tax/constants";
import {
  Account,
  Household,
  bucketOf,
  ageInYear,
  gainFraction,
} from "./accounts";
import { adjustedAnnualBenefit } from "./socialSecurity";
import { money } from "./format";

export type StrategyId = "smart" | "conventional" | "proportional";

export const STRATEGY_META: Record<StrategyId, { label: string; blurb: string }> = {
  smart: {
    label: "Smart (bracket-fill)",
    blurb:
      "Take required RMDs, then fill up the low tax brackets with pre-tax dollars, use the brokerage next, and spend tax-free Roth last. Aims for the lowest lifetime tax.",
  },
  conventional: {
    label: "Conventional order",
    blurb:
      "The common rule of thumb: spend taxable (brokerage) first, then pre-tax, then Roth last — RMDs still come out first.",
  },
  proportional: {
    label: "Proportional",
    blurb: "Pull from every account in proportion to its balance. Simple, but rarely tax-optimal.",
  },
};

/** Target ceiling (top of ordinary bracket) the smart strategy fills pre-tax to. */
export type BracketTarget = 0.12 | 0.22 | 0.24 | 0.32;

export interface Draws {
  pretax: number;
  taxable: number;
  roth: number;
}

export interface RmdDetail {
  owner: "self" | "spouse";
  age: number;
  startAge: number;
  pretaxBalance: number;
  factor: number;
  amount: number;
}

/** Per-owner RMD for the year (current balance approximates prior year-end). */
export function computeRmd(household: Household, year: number): { total: number; details: RmdDetail[] } {
  const details: RmdDetail[] = [];
  for (const who of ["self", "spouse"] as const) {
    const person = household[who];
    const age = ageInYear(person.birthYear, year);
    const startAge = rmdStartAge(person.birthYear);
    const pretaxBalance = household.accounts
      .filter((a) => a.owner === who && bucketOf(a.kind) === "pretax")
      .reduce((s, a) => s + a.balance, 0);
    const factor = age >= startAge ? uniformLifetimeFactor(age) : 0;
    const amount = factor > 0 ? pretaxBalance / factor : 0;
    details.push({ owner: who, age, startAge, pretaxBalance, factor, amount });
  }
  return { total: details.reduce((s, d) => s + d.amount, 0), details };
}

interface YearContext {
  year: number;
  pension: number;
  socialSecurity: number;
  dividends: number; // qualified
  ordinaryDividends: number;
  taxableInterest: number;
  taxExemptInterest: number;
  num65Plus: number;
  gainFraction: number; // unrealized-gain share of a taxable withdrawal
  balances: { pretax: number; roth: number; taxable: number };
}

/** Full tax + cash picture for a candidate set of withdrawals. */
function evaluate(ctx: YearContext, draws: Draws): { tax: TaxResult; grossInflow: number; netCash: number } {
  const longTermGains = draws.taxable * ctx.gainFraction;
  const tax = computeTaxes({
    otherOrdinaryIncome: ctx.pension,
    preTaxWithdrawals: draws.pretax,
    socialSecurity: ctx.socialSecurity,
    qualifiedDividends: ctx.dividends,
    longTermGains,
    taxableInterest: ctx.taxableInterest,
    ordinaryDividends: ctx.ordinaryDividends,
    taxExemptInterest: ctx.taxExemptInterest,
    num65Plus: ctx.num65Plus,
  });
  // All of this is cash the household receives, reducing how much it must withdraw.
  const fixedIncome =
    ctx.socialSecurity + ctx.pension + ctx.dividends + ctx.ordinaryDividends + ctx.taxableInterest + ctx.taxExemptInterest;
  const grossInflow = fixedIncome + draws.pretax + draws.taxable + draws.roth;
  return { tax, grossInflow, netCash: grossInflow - tax.totalTax };
}

/**
 * Binary-search the additional draw from one bucket needed to reach the
 * after-tax `targetNet`, capped at `cap`. netCash is monotonic in the draw, so
 * a bisection converges. Returns the draw amount (≤ cap).
 */
function solveBucket(
  ctx: YearContext,
  base: Draws,
  bucket: keyof Draws,
  cap: number,
  targetNet: number,
): number {
  if (cap <= 0) return 0;
  const atCap = evaluate(ctx, { ...base, [bucket]: base[bucket] + cap }).netCash;
  if (atCap < targetNet) return cap; // even the whole bucket isn't enough
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const net = evaluate(ctx, { ...base, [bucket]: base[bucket] + mid }).netCash;
    if (net >= targetNet) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Largest extra pre-tax withdrawal that keeps ordinary taxable income at or
 * below the top of the chosen bracket (used by the smart "fill the bracket"
 * step). Binary search because Social Security taxability bends the curve.
 */
function pretaxRoomToBracket(ctx: YearContext, base: Draws, ceiling: number, cap: number): number {
  if (cap <= 0) return 0;
  const atCap = evaluate(ctx, { ...base, pretax: base.pretax + cap }).tax.ordinaryTaxableIncome;
  if (atCap <= ceiling) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const oti = evaluate(ctx, { ...base, pretax: base.pretax + mid }).tax.ordinaryTaxableIncome;
    if (oti <= ceiling) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface YearPlan {
  year: number;
  selfAge: number;
  spouseAge: number;
  strategy: StrategyId;
  rmd: number;
  rmdDetails: RmdDetail[];
  fixed: {
    socialSecurity: number;
    pension: number;
    dividends: number;
    ordinaryDividends: number;
    taxableInterest: number;
    taxExemptInterest: number;
  };
  withdrawals: Draws; // pretax INCLUDES the RMD
  spendingTarget: number;
  grossInflow: number;
  netCash: number;
  shortfall: number; // > 0 means assets ran out / target unmet
  tax: TaxResult;
  notes: string[];
}

export interface PlanParams {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  year: number;
}

/**
 * Build one year's withdrawal plan. `household.annualSpending` is the desired
 * AFTER-TAX spend; the engine grosses it up to cover the resulting tax.
 */
export function planYear(household: Household, params: PlanParams): YearPlan {
  const { year, strategy, bracketTarget } = params;
  const selfAge = ageInYear(household.self.birthYear, year);
  const spouseAge = ageInYear(household.spouse.birthYear, year);
  const num65Plus = (selfAge >= 65 ? 1 : 0) + (spouseAge >= 65 ? 1 : 0);

  // The stored benefit is the full-retirement (PIA) amount; the actual check is
  // reduced for early claiming or boosted by delayed-retirement credits, and is
  // only received once each spouse reaches their claim age.
  const ssSelf =
    selfAge >= household.self.ssClaimAge
      ? adjustedAnnualBenefit(household.self.socialSecurityAnnual, household.self.birthYear, household.self.ssClaimAge)
      : 0;
  const ssSpouse =
    spouseAge >= household.spouse.ssClaimAge
      ? adjustedAnnualBenefit(household.spouse.socialSecurityAnnual, household.spouse.birthYear, household.spouse.ssClaimAge)
      : 0;
  const socialSecurity = ssSelf + ssSpouse;

  const balances = {
    pretax: household.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0),
    roth: household.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0),
    taxable: household.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0),
  };
  const gf = gainFraction(household.accounts);

  const ctx: YearContext = {
    year,
    pension: household.pensionAnnual,
    socialSecurity,
    dividends: household.brokerageDividendsAnnual,
    ordinaryDividends: household.ordinaryDividendsAnnual ?? 0,
    taxableInterest: household.taxableInterestAnnual ?? 0,
    taxExemptInterest: household.taxExemptInterestAnnual ?? 0,
    num65Plus,
    gainFraction: gf,
    balances,
  };

  const { total: rmd, details: rmdDetails } = computeRmd(household, year);
  const notes: string[] = [];

  // 1) Mandatory: take the RMD out of pre-tax first.
  const draws: Draws = { pretax: Math.min(rmd, balances.pretax), taxable: 0, roth: 0 };
  if (rmd > 0) {
    notes.push(
      `Required minimum distribution of ${money(rmd)} must come out of pre-tax accounts this year (ages ${rmdDetails
        .filter((d) => d.amount > 0)
        .map((d) => `${d.owner === "self" ? household.self.label : household.spouse.label} ${d.age}`)
        .join(", ")}).`,
    );
  }

  const target = household.annualSpending;
  let net = evaluate(ctx, draws).netCash;

  if (net >= target) {
    notes.push(
      rmd > 0
        ? "Social Security, pension, dividends and the required RMD already cover your spending — no extra withdrawals needed (any surplus can be reinvested in your brokerage)."
        : "Social Security, pension and dividends already cover your spending — no withdrawals needed yet.",
    );
  } else {
    // 2) Fill the gap by strategy.
    const remainingPretax = () => balances.pretax - draws.pretax;
    const remainingTaxable = () => balances.taxable - draws.taxable;
    const remainingRoth = () => balances.roth - draws.roth;

    const fill = (bucket: keyof Draws, cap: number) => {
      if (cap <= 0) return;
      const add = solveBucket(ctx, draws, bucket, cap, target);
      draws[bucket] += add;
      net = evaluate(ctx, draws).netCash;
    };

    if (strategy === "smart") {
      const ceiling = ordinaryBracketCeiling(bracketTarget);
      const room = pretaxRoomToBracket(ctx, draws, ceiling, remainingPretax());
      fill("pretax", room);
      if (net < target) fill("taxable", remainingTaxable());
      if (net < target) fill("roth", remainingRoth());
      if (net < target) fill("pretax", remainingPretax());
      notes.push(
        `Filled the ${(bracketTarget * 100).toFixed(0)}% bracket with pre-tax dollars, then drew from the brokerage, keeping tax-free Roth in reserve.`,
      );
    } else if (strategy === "conventional") {
      fill("taxable", remainingTaxable());
      if (net < target) fill("pretax", remainingPretax());
      if (net < target) fill("roth", remainingRoth());
      notes.push("Spent the brokerage first, then pre-tax, leaving Roth for last.");
    } else {
      // proportional across whatever balances remain
      const totalRem = remainingPretax() + remainingTaxable() + remainingRoth();
      if (totalRem > 0) {
        const gap = target - net;
        const grab = Math.min(gap * 1.4, totalRem); // rough gross-up, then trim
        fill("pretax", (remainingPretax() / totalRem) * grab);
        fill("taxable", (remainingTaxable() / totalRem) * grab);
        fill("roth", (remainingRoth() / totalRem) * grab);
        if (net < target) fill("pretax", remainingPretax());
        if (net < target) fill("taxable", remainingTaxable());
        if (net < target) fill("roth", remainingRoth());
      }
      notes.push("Drew from every bucket in proportion to its size.");
    }
  }

  const finalEval = evaluate(ctx, draws);
  const shortfall = Math.max(0, target - finalEval.netCash);
  if (shortfall > 1) {
    notes.push(`⚠️ Assets can't fully cover spending this year — short by about ${money(shortfall)}.`);
  }

  // IRMAA awareness.
  if (finalEval.tax.irmaa.perPerson > 0) {
    notes.push(
      `Heads up: this income lands in a Medicare IRMAA tier (${finalEval.tax.irmaa.label}) — about ${money(
        finalEval.tax.irmaa.householdAnnual,
      )}/yr in extra Part B & D premiums for the couple, two years out.`,
    );
  }
  if (finalEval.tax.niit > 0) {
    notes.push(`The 3.8% Net Investment Income Tax applies (${money(finalEval.tax.niit)}).`);
  }

  return {
    year,
    selfAge,
    spouseAge,
    strategy,
    rmd,
    rmdDetails,
    fixed: {
      socialSecurity,
      pension: household.pensionAnnual,
      dividends: household.brokerageDividendsAnnual,
      ordinaryDividends: household.ordinaryDividendsAnnual ?? 0,
      taxableInterest: household.taxableInterestAnnual ?? 0,
      taxExemptInterest: household.taxExemptInterestAnnual ?? 0,
    },
    withdrawals: draws,
    spendingTarget: target,
    grossInflow: finalEval.grossInflow,
    netCash: finalEval.netCash,
    shortfall,
    tax: finalEval.tax,
    notes,
  };
}
