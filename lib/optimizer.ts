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

import { computeTaxes, ordinaryBracketCeiling, arbitrageCeiling, TaxResult } from "./tax/engine";
import { StateCode } from "./tax/state";
import { rmdStartAge, uniformLifetimeFactor, FilingStatus } from "./tax/constants";
import {
  Account,
  Household,
  bucketOf,
  ageInYear,
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
  // A non-real spouse (the app's "no spouse" sentinel is birthYear <= 1900) must
  // never emit an RMD of their own — a sentinel age ~130 hits the age-120 floor
  // (factor 2.0) and would force out 50% of the balance every year. But any
  // account data still marked owner:"spouse" is REAL money, so it's attributed to
  // self (otherwise it would silently never get an RMD at all).
  const spouseIsReal = household.spouse.birthYear > 1900;
  for (const who of ["self", "spouse"] as const) {
    const person = household[who];
    if (who === "spouse" && !spouseIsReal) continue;
    const age = ageInYear(person.birthYear, year);
    const startAge = rmdStartAge(person.birthYear);
    const pretaxBalance = household.accounts
      .filter((a) => (a.owner === who || (who === "self" && !spouseIsReal && a.owner === "spouse")) && bucketOf(a.kind) === "pretax")
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
  /** When false/undefined (the default) dividends & interest are REINVESTED: they're
   *  still taxed each year (see the ctx.* fields fed to computeTaxes) but they do NOT
   *  cover spending, so the household withdraws more. When true they're taken as cash
   *  that covers spending (the opt-in). */
  spendDividends?: boolean;
  num65Plus: number;
  // Taxable withdrawals come CASH-FIRST: the first `cashTaxable` dollars are cash/
  // savings (zero embedded gain), and only dollars beyond that sell appreciated
  // brokerage at `brokerageGainFraction`. This realizes the least capital gain and
  // preserves the most-appreciated lots for the step-up at death — and the engine's
  // tax math must match the projection's cash-first draw order.
  cashTaxable: number;
  brokerageGainFraction: number; // unrealized-gain share of a brokerage (non-cash) sale
  balances: { pretax: number; roth: number; taxable: number };
  state: StateCode;
  inflationFactor: number;
  filingStatus: FilingStatus;
  /** MAGI from 2 years prior, for the IRMAA lookback (undefined → same-year). */
  irmaaMagi?: number;
}

/** Full tax + cash picture for a candidate set of withdrawals. `wantMarginal`
 *  turns on the effective-marginal-rate finite difference — a 2nd tax pass we
 *  only need on the FINAL committed plan, not on the ~40 bisection probes per
 *  year, so the default skips it (a big Monte-Carlo speedup). */
function evaluate(
  ctx: YearContext,
  draws: Draws,
  wantMarginal = false,
): { tax: TaxResult; grossInflow: number; netCash: number } {
  // Cash-first: the first ctx.cashTaxable dollars realize no gain; only the excess
  // sells brokerage and realizes long-term gain.
  const longTermGains = Math.max(0, draws.taxable - ctx.cashTaxable) * ctx.brokerageGainFraction;
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
    year: ctx.year,
    irmaaMagi: ctx.irmaaMagi,
    state: ctx.state,
    inflationFactor: ctx.inflationFactor,
    filingStatus: ctx.filingStatus,
    _noMarginal: !wantMarginal,
  });
  // Dividends & interest are taxed every year regardless (the ctx.* fields above feed
  // computeTaxes). Whether they ALSO cover spending is the household's choice: by
  // default they're reinvested (compound in the account, don't reduce withdrawals);
  // only when the user opts to spend them do they count as cash in hand here.
  const investmentIncome = ctx.dividends + ctx.ordinaryDividends + ctx.taxableInterest + ctx.taxExemptInterest;
  const fixedIncome = ctx.socialSecurity + ctx.pension + (ctx.spendDividends ? investmentIncome : 0);
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
 * Largest extra pre-tax amount (withdrawal OR conversion) that keeps ordinary
 * taxable income at or below `targetOTI`, given everything else in the year
 * (Social Security taxability bends the curve, so this is a bisection). Used
 * both by the smart "fill the bracket" spending step and by the Roth-conversion
 * overlay to fill up to any income target.
 */
export function pretaxRoomToTarget(ctx: YearContext, base: Draws, targetOTI: number, cap: number): number {
  if (cap <= 0) return 0;
  const atCap = evaluate(ctx, { ...base, pretax: base.pretax + cap }).tax.ordinaryTaxableIncome;
  if (atCap <= targetOTI) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const oti = evaluate(ctx, { ...base, pretax: base.pretax + mid }).tax.ordinaryTaxableIncome;
    if (oti <= targetOTI) lo = mid;
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
  tax: TaxResult; // INCLUDES the tax on any Roth conversion below
  /** Gross pre-tax dollars converted to Roth this year (0 if none). Separate
   *  from `withdrawals` because a conversion funds Roth, not spending. */
  conversion: number;
  /** Incremental tax (federal + state) caused by this year's conversion (already
   *  in `tax`). In Illinois this is federal-only, since IL exempts conversions. */
  conversionTax: number;
  /** Inflation index used for this year's brackets — callers (e.g. the
   *  opportunity detector) must scale nominal bracket ceilings by it. */
  inflationFactor: number;
  /** Filing status used this year (so callers like the opportunity detector
   *  pick the right brackets/IRMAA tiers). */
  filingStatus: FilingStatus;
  notes: string[];
}

export interface PlanParams {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  year: number;
  /**
   * When set, AFTER funding spending the planner converts pre-tax → Roth (the
   * "rollover to defuse the RMD tax bomb" move). Two modes:
   *  - fillBracket: fill up to the top of `toBracket` (the advanced manual lever).
   *  - recommended: rate-arbitrage — convert only while today's marginal rate is
   *    at or below `futureRate` (the rate this household is projected to face in
   *    its worst future RMD year), filling up to the top of that future bracket,
   *    optionally capped at `capOTI`. This is the smart default.
   * Either way it's NOT spending: the dollars land in Roth and the extra tax is
   * paid from cash (or withheld), shrinking future forced RMDs.
   */
  conversion?: ConversionParam;
  /** Inflation index for this year vs. the base year — scales the tax brackets,
   *  deductions, and the conversion/spending bracket targets. Default 1. */
  inflationFactor?: number;
  /** Filing status this year — "single" once a surviving spouse files alone. Default "mfj". */
  filingStatus?: FilingStatus;
  /** MAGI from 2 years prior, for the IRMAA lookback (a projection supplies it;
   *  the single-year planner omits it and IRMAA falls back to this year's MAGI). */
  irmaaMagi?: number;
  /** "reinvest" (default) → dividends & interest compound and don't cover spending;
   *  "spend" → they're taken as cash that reduces withdrawals. */
  dividendMode?: "reinvest" | "spend";
}

export type ConversionParam =
  | { mode: "fillBracket"; toBracket: BracketTarget }
  | { mode: "recommended"; futureRate: number; capOTI?: number }
  // A pre-set dollar amount to convert (capped at the pre-tax left after spending).
  // Used by the spend-impact sweep so the rollover is a CONSTANT baseline across
  // spending levels — see the note in planYear's conversion overlay.
  | { mode: "fixed"; amount: number }
  | null;

/**
 * Build one year's withdrawal plan. `household.annualSpending` is the desired
 * AFTER-TAX spend; the engine grosses it up to cover the resulting tax.
 */
export function planYear(household: Household, params: PlanParams): YearPlan {
  const { year, strategy, bracketTarget } = params;
  const selfAge = ageInYear(household.self.birthYear, year);
  const spouseAge = ageInYear(household.spouse.birthYear, year);
  const filingStatus: FilingStatus = params.filingStatus ?? "mfj";
  // A single survivor counts only the SURVIVING (younger) spouse for the age-65
  // deductions — never the deceased spouse, even though their age field lingers.
  const num65Plus =
    filingStatus === "single"
      ? Math.min(selfAge, spouseAge) >= 65
        ? 1
        : 0
      : (selfAge >= 65 ? 1 : 0) + (spouseAge >= 65 ? 1 : 0);

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
  // Cash-first taxable draw: the cash/savings tranche (zero gain) is sold before any
  // appreciated brokerage, so the marginal taxable dollar realizes brokerage gain
  // only after cash is exhausted. The projection draws in this same order.
  const taxableAccts = household.accounts.filter((a) => bucketOf(a.kind) === "taxable");
  const cashTaxable = taxableAccts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
  const brokerageAccts = taxableAccts.filter((a) => a.kind !== "cash");
  const brokerageBal = brokerageAccts.reduce((s, a) => s + a.balance, 0);
  const brokerageGain = brokerageAccts.reduce((s, a) => s + Math.max(0, a.balance - (a.costBasis ?? a.balance)), 0);
  const brokerageGainFraction = brokerageBal > 0 ? Math.min(1, brokerageGain / brokerageBal) : 0;

  const ctx: YearContext = {
    year,
    pension: household.pensionAnnual,
    socialSecurity,
    dividends: household.brokerageDividendsAnnual,
    ordinaryDividends: household.ordinaryDividendsAnnual ?? 0,
    taxableInterest: household.taxableInterestAnnual ?? 0,
    taxExemptInterest: household.taxExemptInterestAnnual ?? 0,
    num65Plus,
    cashTaxable,
    brokerageGainFraction,
    balances,
    state: household.state ?? "IL",
    inflationFactor: params.inflationFactor ?? 1,
    filingStatus,
    irmaaMagi: params.irmaaMagi,
    spendDividends: params.dividendMode === "spend",
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
      ctx.spendDividends
        ? rmd > 0
          ? "Social Security, pension, dividends and the required RMD already cover your spending — no extra withdrawals needed (any surplus can be reinvested in your brokerage)."
          : "Social Security, pension and dividends already cover your spending — no withdrawals needed yet."
        : rmd > 0
          ? "Social Security, pension and the required RMD already cover your spending — no extra withdrawals needed."
          : "Social Security and pension already cover your spending — no withdrawals needed yet.",
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
      const ceiling = ordinaryBracketCeiling(bracketTarget, ctx.filingStatus) * ctx.inflationFactor;
      const room = pretaxRoomToTarget(ctx, draws, ceiling, remainingPretax());
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

  const finalEval = evaluate(ctx, draws, true); // committed plan → wants the effective marginal rate
  const shortfall = Math.max(0, target - finalEval.netCash);
  if (shortfall > 1) {
    notes.push(`⚠️ Assets can't fully cover spending this year — short by about ${money(shortfall)}.`);
  }

  // --- Optional Roth-conversion overlay -------------------------------------
  // Once spending is funded, fill remaining pre-tax room up to an income target
  // by moving pre-tax → Roth. pretaxRoomToTarget finds the largest extra pre-tax
  // amount that stays at/under that target, given everything else this year (SS
  // taxability, gains stacking). Skipped in a shortfall year (no point adding tax).
  let conversion = 0;
  let conversionTax = 0;
  let taxResult = finalEval.tax;
  const conv = params.conversion;
  if (conv && shortfall <= 1) {
    const remainingPretax = Math.max(0, balances.pretax - draws.pretax);

    if (conv.mode === "fixed") {
      // A pre-set dollar conversion. The spend-impact sweep uses this so the
      // rollover stays a FIXED baseline as it varies spending — otherwise a
      // bracket-fill rule re-solves at every spend level (shrinking as spending
      // rises), which makes this year's MAGI move BACKWARDS as you spend more and
      // the Medicare/tax read-outs run the wrong way. A constant conversion keeps
      // MAGI a clean, monotonic function of spending while still reflecting the
      // rollover's tax and IRMAA. Capped at the pre-tax left after funding spending.
      conversion = Math.min(Math.max(0, conv.amount), remainingPretax);
      if (conversion > 1) {
        const withConv = evaluate(ctx, { ...draws, pretax: draws.pretax + conversion }, true);
        conversionTax = Math.max(0, withConv.tax.totalTax - finalEval.tax.totalTax);
        taxResult = withConv.tax;
        notes.push(
          `Roll about ${money(conversion)} from pre-tax to Roth this year. It costs roughly ${money(
            conversionTax,
          )} in ${ctx.state === "IL" ? "federal" : "income"} tax now${
            ctx.state === "IL" ? " (Illinois doesn't tax conversions, so that's the whole bill)" : ""
          }, best paid from cash savings — but it permanently shrinks the pre-tax balance that drives future RMDs.`,
        );
      }
    } else {
    // The ordinary-taxable-income level to fill pre-tax up to (−1 = don't convert).
    let targetOTI = -1;
    let label = "";
    if (conv.mode === "fillBracket") {
      targetOTI = ordinaryBracketCeiling(conv.toBracket, ctx.filingStatus) * ctx.inflationFactor;
      label = `filling the ${(conv.toBracket * 100).toFixed(0)}% bracket`;
    } else {
      // Recommended (smoothing): convert only the dollars that are STRICTLY
      // cheaper now than later — BUT keep it smooth by never filling past the
      // user's comfort bracket (bracketTarget, e.g. 22%). The goal is steady,
      // low-bracket rollovers, not a single huge conversion that itself jumps
      // into a high bracket. So we fill up to whichever is LOWER:
      //   • the floor of the future RMD-era bracket (rate-arbitrage ceiling), or
      //   • the top of the comfort bracket (the "stay smooth" cap).
      // Pushing higher than the comfort bracket is the advanced fill-the-bracket
      // option, which the user opts into deliberately.
      // Compare TRUE marginal cost now vs. later — the effective marginal rate
      // folds in the Social Security tax torpedo, NIIT, and the senior-bonus
      // phaseout, so we never convert a dollar whose real cost today exceeds the
      // future rate we're avoiding (futureRate is likewise an effective rate).
      const rNow = finalEval.tax.effectiveMarginalRate;
      if (conv.futureRate > 0 && rNow < conv.futureRate - 1e-9) {
        const arbCeiling = arbitrageCeiling(conv.futureRate, ctx.filingStatus);
        const comfortCeiling = ordinaryBracketCeiling(bracketTarget, ctx.filingStatus);
        const fillTo = Math.min(arbCeiling, comfortCeiling);
        targetOTI = fillTo * ctx.inflationFactor;
        if (conv.capOTI != null) targetOTI = Math.min(targetOTI, conv.capOTI);
        const reachedBracket = Math.round(Math.min(bracketTarget, conv.futureRate) * 100);
        label = `filling your low brackets up to about ${reachedBracket}% — staying well below the ${Math.round(
          conv.futureRate * 100,
        )}% your future RMDs would otherwise hit`;
      }
    }

    if (targetOTI > 0) {
      const room = pretaxRoomToTarget(ctx, draws, targetOTI, remainingPretax);
      if (room > 1) {
        conversion = room;
        const withConv = evaluate(ctx, { ...draws, pretax: draws.pretax + conversion }, true); // committed → wants marginal
        conversionTax = Math.max(0, withConv.tax.totalTax - finalEval.tax.totalTax);
        taxResult = withConv.tax; // the year's tax now reflects the conversion income
        notes.push(
          `Roll about ${money(conversion)} from pre-tax to Roth this year, ${label}. It costs roughly ${money(
            conversionTax,
          )} in ${ctx.state === "IL" ? "federal" : "income"} tax now${
            ctx.state === "IL" ? " (Illinois doesn't tax conversions, so that's the whole bill)" : ""
          }, best paid from cash savings — but it permanently shrinks the pre-tax balance that drives future RMDs, then grows tax-free with no RMDs of its own.`,
        );
      }
    }
    }
  }

  // IRMAA fallback years must not price the conversion. When the caller has no
  // 2-year MAGI lookback yet (the first two projection years), the engine falls
  // back to same-year MAGI — but those years' real premiums were set by income
  // from BEFORE the projection window, which this year's conversion cannot have
  // raised. Left as-is, an early conversion was billed in the fallback years AND
  // again when the real lookback kicked in (double-billed), biasing the advisor
  // against early conversions. Price the fallback on pre-conversion MAGI instead.
  if (params.irmaaMagi == null && conversion > 0) {
    taxResult = { ...taxResult, irmaa: finalEval.tax.irmaa };
  }

  // IRMAA / NIIT awareness — reflect the conversion income too.
  if (taxResult.irmaa.perPerson > 0) {
    notes.push(
      `Heads up: this income lands in a Medicare IRMAA tier (${taxResult.irmaa.label}) — about ${money(
        taxResult.irmaa.householdAnnual,
      )}/yr in extra Part B & D premiums for the couple, two years out.`,
    );
  }
  if (taxResult.niit > 0) {
    notes.push(`The 3.8% Net Investment Income Tax applies (${money(taxResult.niit)}).`);
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
    tax: taxResult,
    conversion,
    conversionTax,
    inflationFactor: params.inflationFactor ?? 1,
    filingStatus,
    notes,
  };
}
