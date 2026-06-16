/**
 * Multi-year lifetime projection.
 *
 * Runs the withdrawal strategy year by year: plan the year, draw the money out
 * of the real accounts, reinvest any forced RMD surplus, grow what's left, and
 * inflate next year's spending. Accumulates lifetime federal tax so two
 * strategies can be compared apples-to-apples.
 *
 * ⚠️ Educational estimates only — not tax advice. Returns/inflation are
 * assumptions, not predictions.
 */

import { Account, Household, bucketOf } from "./accounts";
import { planYear, StrategyId, BracketTarget, YearPlan } from "./optimizer";

export interface ProjectionAssumptions {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  /** Nominal annual growth on invested balances (e.g. 0.05). */
  returnRate: number;
  /** Annual inflation applied to spending (e.g. 0.025). */
  inflationRate: number;
  /** Project until BOTH spouses would be older than this age. */
  endAge: number;
}

export interface ProjectionRow {
  year: number;
  selfAge: number;
  spouseAge: number;
  rmd: number;
  fromPretax: number;
  fromTaxable: number;
  fromRoth: number;
  tax: number;
  taxableSS: number;
  marginalRate: number;
  /** Annual household Medicare IRMAA surcharge triggered by this year's income. */
  irmaa: number;
  netCash: number;
  spendingTarget: number;
  startBalances: { pretax: number; roth: number; taxable: number; total: number };
  endTotal: number;
  shortfall: boolean;
}

export interface ProjectionResult {
  rows: ProjectionRow[];
  lifetimeTax: number;
  endingEstate: number; // GROSS total balance left at the end
  /** After-tax estate: pre-tax discounted by an assumed heir rate, taxable
   *  gains by 15%. A fair apples-to-apples comparison between strategies, since
   *  a pre-tax dollar still owes income tax when withdrawn. */
  endingEstateAfterTax: number;
  endingBuckets: { pretax: number; roth: number; taxable: number; taxableGain: number };
  yearsModeled: number;
  depleted: boolean; // ran out of money before endAge
}

/** Assumed ordinary rate the heirs/owner eventually pay to liquidate pre-tax
 *  dollars (used only for the after-tax estate comparison). */
export const ASSUMED_LIQUIDATION_RATE = 0.22;

function cloneHousehold(h: Household): Household {
  return {
    ...h,
    self: { ...h.self },
    spouse: { ...h.spouse },
    accounts: h.accounts.map((a) => ({ ...a })),
  };
}

/** Draw `amount` out of the accounts in one bucket, proportionally, basis-aware. */
function drawFromBucket(accounts: Account[], bucket: "pretax" | "roth" | "taxable", amount: number) {
  if (amount <= 0) return;
  const inBucket = accounts.filter((a) => bucketOf(a.kind) === bucket);
  const total = inBucket.reduce((s, a) => s + a.balance, 0);
  if (total <= 0) return;
  const ratio = Math.min(1, amount / total);
  for (const a of inBucket) {
    if (a.balance <= 0) continue; // nothing to sell (avoids 0/0 on basis)
    const take = a.balance * ratio;
    if (bucket === "taxable" && a.costBasis != null) {
      // reduce basis proportionally to the shares sold
      a.costBasis = a.costBasis * (1 - take / a.balance);
    }
    a.balance -= take;
  }
}

/** Reinvest after-tax surplus cash into the brokerage (new money = full basis). */
function reinvestSurplus(accounts: Account[], amount: number) {
  if (amount <= 0) return;
  const brokerage = accounts.find((a) => a.kind === "brokerage") ?? accounts.find((a) => bucketOf(a.kind) === "taxable");
  if (brokerage) {
    brokerage.balance += amount;
    brokerage.costBasis = (brokerage.costBasis ?? 0) + amount;
  }
}

function growAll(accounts: Account[], rate: number) {
  for (const a of accounts) {
    if (a.kind === "cash") continue; // treat cash as non-growing
    a.balance *= 1 + rate;
  }
}

export function projectLifetime(household: Household, assumptions: ProjectionResultInput): ProjectionResult {
  const { strategy, bracketTarget, returnRate, inflationRate, endAge } = assumptions;
  const h = cloneHousehold(household);
  const startYear = new Date().getFullYear();
  const rows: ProjectionRow[] = [];
  let lifetimeTax = 0;
  let depleted = false;

  for (let year = startYear; year <= startYear + 60; year++) {
    const selfAge = year - h.self.birthYear;
    const spouseAge = year - h.spouse.birthYear;
    if (selfAge > endAge && spouseAge > endAge) break;

    const startBalances = {
      pretax: h.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0),
      roth: h.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0),
      taxable: h.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0),
      total: 0,
    };
    startBalances.total = startBalances.pretax + startBalances.roth + startBalances.taxable;

    const plan: YearPlan = planYear(h, { strategy, bracketTarget, year });

    // Apply withdrawals. pretax draw includes the RMD.
    drawFromBucket(h.accounts, "pretax", plan.withdrawals.pretax);
    drawFromBucket(h.accounts, "taxable", plan.withdrawals.taxable);
    drawFromBucket(h.accounts, "roth", plan.withdrawals.roth);

    // Forced surplus (RMD bigger than the need) is reinvested in the brokerage.
    const surplus = plan.netCash - plan.spendingTarget;
    if (surplus > 0) reinvestSurplus(h.accounts, surplus);

    lifetimeTax += plan.tax.totalTax;

    growAll(h.accounts, returnRate);

    const endTotal = h.accounts.reduce((s, a) => s + a.balance, 0);

    rows.push({
      year,
      selfAge,
      spouseAge,
      rmd: plan.rmd,
      fromPretax: plan.withdrawals.pretax,
      fromTaxable: plan.withdrawals.taxable,
      fromRoth: plan.withdrawals.roth,
      tax: plan.tax.totalTax,
      taxableSS: plan.tax.taxableSocialSecurity,
      marginalRate: plan.tax.marginalOrdinaryRate,
      irmaa: plan.tax.irmaa.householdAnnual,
      netCash: plan.netCash,
      spendingTarget: plan.spendingTarget,
      startBalances,
      endTotal,
      shortfall: plan.shortfall > 1,
    });

    if (plan.shortfall > 1 && !depleted) depleted = true;

    // Inflate next year's spending.
    h.annualSpending *= 1 + inflationRate;
  }

  const endPretax = h.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0);
  const endRoth = h.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0);
  const endTaxable = h.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0);
  const endTaxableGain = h.accounts
    .filter((a) => bucketOf(a.kind) === "taxable")
    .reduce((s, a) => s + Math.max(0, a.balance - (a.costBasis ?? a.balance)), 0);

  const endingEstate = endPretax + endRoth + endTaxable;
  const endingEstateAfterTax =
    endPretax * (1 - ASSUMED_LIQUIDATION_RATE) + endRoth + (endTaxable - endTaxableGain * 0.15);

  return {
    rows,
    lifetimeTax,
    endingEstate,
    endingEstateAfterTax,
    endingBuckets: { pretax: endPretax, roth: endRoth, taxable: endTaxable, taxableGain: endTaxableGain },
    yearsModeled: rows.length,
    depleted,
  };
}

// Alias kept readable in the function signature above.
type ProjectionResultInput = ProjectionAssumptions;
