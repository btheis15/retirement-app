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
import { adjustedAnnualBenefit, fullRetirementAge } from "./socialSecurity";

export interface ProjectionAssumptions {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  /** Nominal annual growth on invested balances (e.g. 0.05). */
  returnRate: number;
  /** Annual inflation applied to spending (e.g. 0.025). */
  inflationRate: number;
  /** Project until BOTH spouses would be older than this age. */
  endAge: number;
  /**
   * When set, each year through `untilAge` (self's age) the plan converts
   * pre-tax → Roth. mode "recommended" (default) uses rate arbitrage against the
   * household's projected future RMD-era rate; mode "fillBracket" fills the
   * `bracketTarget` bracket. The "rollover to defuse the RMD tax bomb" plan.
   */
  convert?: { untilAge: number; mode: "recommended" | "fillBracket" } | null;
  /**
   * Model the surviving-spouse years (widow's penalty). After the OLDER spouse
   * reaches `firstDeathAge`, the survivor files SINGLE (half-width brackets),
   * keeps only the larger Social Security check, inherits the pre-tax (RMDs
   * continue on their age), and spends `spendingFactor`× the couple's amount.
   */
  survivor?: { firstDeathAge: number; spendingFactor: number } | null;
  /** Monte Carlo: per-year nominal return (yearIndex from start). Overrides the
   *  flat returnRate for growth when present. */
  returnFor?: ((yearIndex: number) => number) | null;
  /** Skip the inner conventional baseline and use this as the recommended-mode
   *  future RMD rate (set by Monte Carlo so conversions don't chase noisy returns). */
  futureRateOverride?: number | null;
}

export interface ProjectionRow {
  year: number;
  selfAge: number;
  spouseAge: number;
  rmd: number;
  fromPretax: number;
  fromTaxable: number;
  fromRoth: number;
  /** Pre-tax dollars rolled to Roth this year (0 if none). */
  conversion: number;
  tax: number;
  taxableSS: number;
  marginalRate: number;
  /** TRUE marginal cost of the next ordinary dollar (incl. SS torpedo / NIIT) —
   *  used to size rate-arbitrage conversions against the real future cost. */
  effMarginalRate: number;
  /** MAGI this year — kept so a later year's IRMAA can look back 2 years. */
  magi: number;
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
  /** Cumulative Medicare IRMAA surcharges paid over the projection (a cash cost
   *  driven up by conversions/RMDs that lift MAGI into higher tiers). */
  lifetimeIrmaa: number;
  endingEstate: number; // GROSS total balance left at the end
  /** After-tax estate: pre-tax discounted by an assumed heir rate, taxable
   *  gains by 15%. A fair apples-to-apples comparison between strategies, since
   *  a pre-tax dollar still owes income tax when withdrawn. */
  endingEstateAfterTax: number;
  endingBuckets: { pretax: number; roth: number; taxable: number; taxableGain: number };
  yearsModeled: number;
  depleted: boolean; // ran out of money before endAge
  /** Total pre-tax dollars rolled to Roth across the whole projection. */
  totalConverted: number;
  /** Largest single-year RMD across the projection (the "tax bomb" peak). */
  peakRmd: number;
  /** Highest ordinary tax bracket touched in any year (conversions included) —
   *  how "high" the plan ever pushes you. Lower = smoother. */
  peakMarginalRate: number;
  /** The worst future RMD-era marginal rate used for recommended conversions
   *  (from the conventional baseline). Exposed so Monte Carlo can reuse it. */
  futureRate: number;
  /** Year the surviving spouse begins filing single (0 if not modeled/in range). */
  survivorYear: number;
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

/**
 * Pay a conversion's tax bill from CASH/savings only, and report how much it
 * covered. We deliberately do NOT sell appreciated brokerage to pay conversion
 * tax: (1) it's the discouraged way to do conversions in real life, and (2) the
 * gain that sale would realize isn't recursively re-taxed in this model, so
 * allowing it would make conversions look better than they are. Whatever cash
 * can't cover is withheld from the conversion itself by the caller (exact, no
 * hidden gain) — slightly conservative, never overstated.
 */
function payConversionTaxFromCash(accounts: Account[], amount: number): number {
  if (amount <= 0) return 0;
  let remaining = amount;
  for (const a of accounts.filter((x) => x.kind === "cash")) {
    if (remaining <= 0) break;
    if (a.balance <= 0) continue;
    const take = Math.min(a.balance, remaining);
    if (a.costBasis != null) a.costBasis = a.costBasis * (1 - take / a.balance);
    a.balance -= take;
    remaining -= take;
  }
  return amount - remaining;
}

/** Credit converted dollars into the largest Roth account (or open one). */
function creditRoth(accounts: Account[], amount: number) {
  if (amount <= 0) return;
  const roths = accounts.filter((a) => bucketOf(a.kind) === "roth");
  const target = roths.sort((a, b) => b.balance - a.balance)[0];
  if (target) target.balance += amount;
  else accounts.push({ id: "roth-converted", label: "Roth (converted)", kind: "roth_ira", owner: "self", balance: amount });
}

/**
 * Move a Roth conversion through the real accounts: pull the gross from pre-tax,
 * pay the conversion tax from taxable/cash, and credit whatever's left to Roth.
 * Anything taxable couldn't cover is withheld from the conversion (so it lands
 * as a taxable distribution that paid the tax, not as Roth).
 */
function applyConversion(accounts: Account[], gross: number, conversionTax: number) {
  if (gross <= 0) return;
  drawFromBucket(accounts, "pretax", gross);
  const paid = payConversionTaxFromCash(accounts, conversionTax);
  const withheld = Math.max(0, conversionTax - paid);
  creditRoth(accounts, Math.max(0, gross - withheld));
}

/**
 * Distribute (pay out) `amount` of dividend/interest income from the brokerage,
 * proportionally, balance only. Dividends aren't return of capital, so basis is
 * unchanged — the share price drops by the dividend, so the unrealized gain
 * correctly shrinks. This carves the distributed income OUT of the brokerage's
 * total-return growth so it isn't double-counted (received as taxable income AND
 * left to compound) — the real reason a taxable account lags a tax-free Roth.
 */
function distributeFromBrokerage(accounts: Account[], amount: number) {
  if (amount <= 0) return;
  const brk = accounts.filter((a) => a.kind !== "cash" && bucketOf(a.kind) === "taxable");
  const total = brk.reduce((s, a) => s + a.balance, 0);
  if (total <= 0) return;
  const ratio = Math.min(1, amount / total);
  for (const a of brk) a.balance -= a.balance * ratio;
}

/** Reinvest after-tax surplus cash into the brokerage (new money = full basis).
 *  Opens a brokerage account if the household has none, so forced RMD surplus is
 *  never silently dropped. */
function reinvestSurplus(accounts: Account[], amount: number) {
  if (amount <= 0) return;
  let brokerage = accounts.find((a) => a.kind === "brokerage") ?? accounts.find((a) => bucketOf(a.kind) === "taxable");
  if (!brokerage) {
    brokerage = { id: "surplus-brokerage", label: "Brokerage (reinvested surplus)", kind: "brokerage", owner: "self", balance: 0, costBasis: 0 };
    accounts.push(brokerage);
  }
  brokerage.balance += amount;
  brokerage.costBasis = (brokerage.costBasis ?? 0) + amount;
}

function growAll(accounts: Account[], rate: number) {
  for (const a of accounts) {
    if (a.kind === "cash") continue; // treat cash as non-growing
    a.balance *= 1 + rate;
  }
}

export function projectLifetime(household: Household, assumptions: ProjectionResultInput): ProjectionResult {
  const { strategy, bracketTarget, returnRate, inflationRate, endAge, convert, survivor, returnFor, futureRateOverride } =
    assumptions;
  const h = cloneHousehold(household);
  const startYear = new Date().getFullYear();
  const rows: ProjectionRow[] = [];
  let lifetimeTax = 0;
  let depleted = false;
  let totalConverted = 0;
  let lifetimeIrmaa = 0; // cumulative Medicare IRMAA surcharges — a real cash drag
  let peakRmd = 0;
  let peakRmdMarginal = 0; // highest marginal rate seen in an RMD year (the bomb's real rate)
  let peakMarginalRate = 0; // highest ordinary bracket touched in ANY year (incl. conversions)
  // IRMAA for premium year T is set by MAGI from year T−2 (statutory lookback).
  // Record each year's MAGI so a later year can look it up. The first two years
  // have no in-projection lookback, so the engine falls back to same-year MAGI.
  const magiByYear = new Map<number, number>();

  // For recommended-mode conversions, derive the marginal rate this household
  // would face in its worst future RMD year if it did NOTHING extra. We use a
  // CONVENTIONAL, no-conversion baseline (forced RMDs, minimal voluntary pre-tax
  // draws) — and KEEP the survivor model so the target reflects the survivor's
  // steeper single-filer rates, which is what makes converting now valuable. The
  // inner call has convert:null (no recursion) and returnFor:null (deterministic,
  // so conversions aren't sized against noisy Monte-Carlo returns).
  let futureRate = 0;
  if (convert && convert.mode === "recommended") {
    if (futureRateOverride != null) {
      futureRate = futureRateOverride;
    } else {
      const baseline = projectLifetime(household, {
        ...assumptions,
        strategy: "conventional",
        convert: null,
        returnFor: null,
      });
      futureRate = baseline.rows.reduce((m, r) => (r.rmd > 0 ? Math.max(m, r.effMarginalRate) : m), 0);
    }
  }

  // Survivor (widow's-penalty) setup: the OLDER spouse dies at firstDeathAge; the
  // younger spouse survives, files single, keeps the larger SS, and inherits the
  // pre-tax (RMDs then run on the survivor's age). Applied once, at the transition.
  const olderWho = h.self.birthYear <= h.spouse.birthYear ? "self" : "spouse";
  const survivorWho = olderWho === "self" ? "spouse" : "self";
  const firstDeathYear = survivor ? h[olderWho].birthYear + survivor.firstDeathAge : Infinity;
  let survivorApplied = false;
  let survivorYear = 0;

  // Tax-drag base: the entered dividends/interest reflect today's balances. Each
  // year we scale them with the relevant balance, so a growing brokerage throws
  // off proportionally more (annually taxed) income and a depleted one less —
  // the real annual tax drag that makes tax-free Roth worth more than taxable.
  const isBrokerage = (a: Account) => a.kind !== "cash" && bucketOf(a.kind) === "taxable";
  const baseDivQ = household.brokerageDividendsAnnual;
  const baseDivO = household.ordinaryDividendsAnnual ?? 0;
  const baseInt = household.taxableInterestAnnual ?? 0;
  const baseMuni = household.taxExemptInterestAnnual ?? 0;
  const initBrokerage = h.accounts.filter(isBrokerage).reduce((s, a) => s + a.balance, 0);
  const initCash = h.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);

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

    // Inflation index for this year — the tax engine uses it to index brackets,
    // deductions, and IRMAA tiers so nominal income/brackets move together.
    const inflationFactor = Math.pow(1 + inflationRate, year - startYear);

    // Tax drag: scale this year's investment income with the current balances.
    const curBrokerage = h.accounts.filter(isBrokerage).reduce((s, a) => s + a.balance, 0);
    const curCash = h.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
    const divFactor = initBrokerage > 0 ? curBrokerage / initBrokerage : 1;
    const intFactor = initCash > 0 ? curCash / initCash : 1;
    h.brokerageDividendsAnnual = baseDivQ * divFactor;
    h.ordinaryDividendsAnnual = baseDivO * divFactor;
    h.taxExemptInterestAnnual = baseMuni * divFactor;
    h.taxableInterestAnnual = baseInt * intFactor;

    // Survivor transition: apply the one-time changes the first year on/after the
    // older spouse's death — keep the larger SS, stop the smaller, inherit the
    // pre-tax (spousal rollover), and drop spending to the survivor factor.
    const isSurvivorYear = survivor != null && year >= firstDeathYear;
    if (isSurvivorYear && !survivorApplied) {
      survivorApplied = true;
      survivorYear = year;
      const selfBenefit = adjustedAnnualBenefit(h.self.socialSecurityAnnual, h.self.birthYear, h.self.ssClaimAge);
      const spouseBenefit = adjustedAnnualBenefit(h.spouse.socialSecurityAnnual, h.spouse.birthYear, h.spouse.ssClaimAge);
      const keptBenefit = Math.max(selfBenefit, spouseBenefit);
      const sv = h[survivorWho];
      // Survivor's benefit becomes the larger check, with a neutral (FRA) claim
      // factor so adjustedAnnualBenefit returns it directly; the deceased's stops.
      h[survivorWho] = { ...sv, socialSecurityAnnual: keptBenefit, ssClaimAge: Math.round(fullRetirementAge(sv.birthYear)) };
      h[olderWho] = { ...h[olderWho], socialSecurityAnnual: 0 };
      for (const a of h.accounts) if (a.owner === olderWho) a.owner = survivorWho;
      h.annualSpending *= survivor.spendingFactor;
    }
    const filingStatus = isSurvivorYear ? ("single" as const) : ("mfj" as const);

    const convertThisYear = convert != null && selfAge <= convert.untilAge;
    const conversionParam = !convertThisYear
      ? null
      : convert!.mode === "recommended"
        ? ({ mode: "recommended", futureRate } as const)
        : ({ mode: "fillBracket", toBracket: bracketTarget } as const);
    const plan: YearPlan = planYear(h, {
      strategy,
      bracketTarget,
      year,
      conversion: conversionParam,
      inflationFactor,
      filingStatus,
      irmaaMagi: magiByYear.get(year - 2), // IRMAA's 2-year MAGI lookback
    });
    magiByYear.set(year, plan.tax.magi);

    // Apply withdrawals. pretax draw includes the RMD.
    drawFromBucket(h.accounts, "pretax", plan.withdrawals.pretax);
    drawFromBucket(h.accounts, "taxable", plan.withdrawals.taxable);
    drawFromBucket(h.accounts, "roth", plan.withdrawals.roth);

    // Roll pre-tax → Roth (tax paid from taxable/cash). Shrinks future RMDs.
    if (plan.conversion > 0) {
      applyConversion(h.accounts, plan.conversion, plan.conversionTax);
      totalConverted += plan.conversion;
    }

    // Forced surplus (RMD bigger than the need) is reinvested in the brokerage.
    const surplus = plan.netCash - plan.spendingTarget;
    if (surplus > 0) reinvestSurplus(h.accounts, surplus);

    lifetimeTax += plan.tax.totalTax;
    lifetimeIrmaa += plan.tax.irmaa.householdAnnual;
    peakRmd = Math.max(peakRmd, plan.rmd);
    if (plan.rmd > 0) peakRmdMarginal = Math.max(peakRmdMarginal, plan.tax.marginalOrdinaryRate);
    peakMarginalRate = Math.max(peakMarginalRate, plan.tax.marginalOrdinaryRate);

    growAll(h.accounts, returnFor ? returnFor(year - startYear) : returnRate);
    // Carve this year's brokerage dividends/interest out of its total-return
    // growth — they were already received as taxable income (funding spending),
    // so leaving them to also compound would double-count and over-credit the
    // taxable account vs. a tax-free Roth.
    distributeFromBrokerage(
      h.accounts,
      (h.brokerageDividendsAnnual ?? 0) + (h.ordinaryDividendsAnnual ?? 0) + (h.taxExemptInterestAnnual ?? 0),
    );

    const endTotal = h.accounts.reduce((s, a) => s + a.balance, 0);

    rows.push({
      year,
      selfAge,
      spouseAge,
      rmd: plan.rmd,
      fromPretax: plan.withdrawals.pretax,
      fromTaxable: plan.withdrawals.taxable,
      fromRoth: plan.withdrawals.roth,
      conversion: plan.conversion,
      tax: plan.tax.totalTax,
      taxableSS: plan.tax.taxableSocialSecurity,
      marginalRate: plan.tax.marginalOrdinaryRate,
      effMarginalRate: plan.tax.effectiveMarginalRate,
      magi: plan.tax.magi,
      irmaa: plan.tax.irmaa.householdAnnual,
      netCash: plan.netCash,
      spendingTarget: plan.spendingTarget,
      startBalances,
      endTotal,
      shortfall: plan.shortfall > 1,
    });

    if (plan.shortfall > 1 && !depleted) depleted = true;

    // Inflate next year's spending, and give Social Security a COLA (proxied by
    // inflation) so it keeps pace with the indexed brackets and rising spending.
    h.annualSpending *= 1 + inflationRate;
    h.self = { ...h.self, socialSecurityAnnual: h.self.socialSecurityAnnual * (1 + inflationRate) };
    h.spouse = { ...h.spouse, socialSecurityAnnual: h.spouse.socialSecurityAnnual * (1 + inflationRate) };
  }

  const endPretax = h.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0);
  const endRoth = h.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0);
  const endTaxable = h.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0);
  const endTaxableGain = h.accounts
    .filter((a) => bucketOf(a.kind) === "taxable")
    .reduce((s, a) => s + Math.max(0, a.balance - (a.costBasis ?? a.balance)), 0);

  const endingEstate = endPretax + endRoth + endTaxable;
  // Leftover pre-tax is a deferred tax bill (income in respect of a decedent — it
  // does NOT get a step-up). Discount it at the rate it would ACTUALLY be
  // withdrawn at — this plan's worst RMD-era marginal rate — floored at the
  // baseline assumption. A plan that leaves a big RMD bomb is valued lower; one
  // that converted it away has little pre-tax left, so the rate barely matters.
  const liquidationRate = Math.max(ASSUMED_LIQUIDATION_RATE, peakRmdMarginal);
  // Brokerage assets get a STEP-UP IN BASIS at death (IRC §1014): the embedded
  // unrealized gain is forgiven, so heirs inherit at full value and owe $0 income
  // tax on it. Roth is already tax-free. (Heirs selling later realize only
  // post-death gains, ~$0 at the moment of death.)
  // Subtract the lifetime Medicare IRMAA surcharges — a real out-of-pocket cost
  // that aggressive conversions (higher MAGI → higher tiers, 2 years later) drive
  // up, so "money you keep" honestly reflects the IRMAA cost of converting.
  const endingEstateAfterTax = endPretax * (1 - liquidationRate) + endRoth + endTaxable - lifetimeIrmaa;

  return {
    rows,
    lifetimeTax,
    lifetimeIrmaa,
    endingEstate,
    endingEstateAfterTax,
    endingBuckets: { pretax: endPretax, roth: endRoth, taxable: endTaxable, taxableGain: endTaxableGain },
    yearsModeled: rows.length,
    depleted,
    totalConverted,
    peakRmd,
    peakMarginalRate,
    futureRate,
    survivorYear,
  };
}

// Alias kept readable in the function signature above.
type ProjectionResultInput = ProjectionAssumptions;
