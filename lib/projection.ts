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
import { dividendBreakdown, bucketGrowthFactor } from "./dividends";

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
  /** Monte Carlo: per-year realized inflation (yearIndex from start). Overrides
   *  the flat inflationRate for spending growth, SS COLA, and bracket indexing
   *  when present (a stochastic AR(1) path). */
  inflationFor?: ((yearIndex: number) => number) | null;
  /** Skip the inner conventional baseline and use this as the recommended-mode
   *  future RMD rate (set by Monte Carlo so conversions don't chase noisy returns). */
  futureRateOverride?: number | null;
  /** Marginal rate a non-spouse heir pays on inherited pre-tax, spread over the
   *  SECURE 10-year window. Drives the after-tax estate. Default 0.24. */
  heirTaxRate?: number;
  /** Spending behavior. "constant" (default) = a fixed REAL amount — the nominal
   *  spend grows with inflation each year, holding lifestyle steady. "flatNominal" =
   *  the same DOLLAR amount every year (real value erodes). "guardrails" =
   *  Guyton-Klinger dynamic spending: flex up in good markets and trim in bad ones. */
  spendingStrategy?: "constant" | "flatNominal" | "guardrails";
  /** "reinvest" (default) → dividends & interest compound in the taxable account and
   *  don't cover spending (so withdrawals rise to cover their yearly tax). "spend" →
   *  they're taken as cash that funds spending (the prior behavior). */
  dividendMode?: "reinvest" | "spend";
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
  /** Cumulative price level at this year (realized-inflation product). Lets a
   *  Monte-Carlo run deflate this year's balance to today's dollars by ITS OWN
   *  inflation path, not a flat average. */
  inflationFactor: number;
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
  /** lifetimeTax in today's (start-year) dollars. */
  lifetimeTaxReal: number;
  /** Cumulative Medicare IRMAA surcharges paid over the projection (a cash cost
   *  driven up by conversions/RMDs that lift MAGI into higher tiers). */
  lifetimeIrmaa: number;
  /** lifetimeIrmaa in today's dollars. */
  lifetimeIrmaaReal: number;
  endingEstate: number; // GROSS total balance left at the end
  /** endingEstate in today's dollars. */
  endingEstateReal: number;
  /** endingEstateAfterTax in today's dollars. */
  endingEstateAfterTaxReal: number;
  /** After-tax estate: pre-tax discounted by an assumed heir rate, taxable
   *  gains by 15%. A fair apples-to-apples comparison between strategies, since
   *  a pre-tax dollar still owes income tax when withdrawn. */
  endingEstateAfterTax: number;
  endingBuckets: { pretax: number; roth: number; taxable: number; taxableGain: number };
  yearsModeled: number;
  depleted: boolean; // ran out of money before endAge
  /** Years funded before the first shortfall (= yearsModeled if never short). Lets
   *  the advisor rank failing plans by how long they last, not just pass/fail. */
  solventYears: number;
  /** Lowest real (today's-dollars) spending in any year ÷ the initial spend. 1.0
   *  means spending never dipped below plan; <1 means a dynamic-spending cut. */
  minRealSpendRatio: number;
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

/** Draw `amount` out of the accounts in one bucket, basis-aware. Pre-tax/Roth are
 *  drawn pro-rata. The TAXABLE bucket is drawn CASH-FIRST: cash/savings (no embedded
 *  gain) is spent before any appreciated brokerage, so the least capital gain is
 *  realized and the most-appreciated lots are preserved for the step-up at death.
 *  This matches the optimizer's cash-first gain assumption (see optimizer.ts ctx). */
function drawFromBucket(accounts: Account[], bucket: "pretax" | "roth" | "taxable", amount: number) {
  if (amount <= 0) return;
  const inBucket = accounts.filter((a) => bucketOf(a.kind) === bucket);
  const total = inBucket.reduce((s, a) => s + a.balance, 0);
  if (total <= 0) return;

  if (bucket === "taxable") {
    // 1) Drain cash/savings first (zero gain realized).
    let remaining = amount;
    for (const a of inBucket.filter((x) => x.kind === "cash")) {
      if (remaining <= 0) break;
      if (a.balance <= 0) continue;
      const take = Math.min(a.balance, remaining);
      if (a.costBasis != null) a.costBasis = a.costBasis * (1 - take / a.balance);
      a.balance -= take;
      remaining -= take;
    }
    // 2) Then sell brokerage pro-rata (blended basis, matching the engine's tax calc).
    if (remaining > 0) {
      const brk = inBucket.filter((x) => x.kind !== "cash");
      const brkTotal = brk.reduce((s, a) => s + a.balance, 0);
      if (brkTotal > 0) {
        const ratio = Math.min(1, remaining / brkTotal);
        for (const a of brk) {
          if (a.balance <= 0) continue;
          const take = a.balance * ratio;
          if (a.costBasis != null) a.costBasis = a.costBasis * (1 - take / a.balance);
          a.balance -= take;
        }
      }
    }
    return;
  }

  // pre-tax / Roth: pro-rata (no basis to optimize)
  const ratio = Math.min(1, amount / total);
  for (const a of inBucket) {
    if (a.balance <= 0) continue; // nothing to sell (avoids 0/0 on basis)
    a.balance -= a.balance * ratio;
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

/**
 * Guyton-Klinger dynamic spending — next year's spend from this year's. Compares
 * the current withdrawal rate to the INITIAL planning rate (W0/P0) and applies:
 *  • Modified Withdrawal Rule: skip the inflation raise after a down year if the
 *    rate is already above the initial rate.
 *  • Capital-Preservation Rule: cut 10% if the rate climbs >20% above initial
 *    (suspended in the final ~15 years — no need to preserve for a short horizon).
 *  • Prosperity Rule: raise 10% if the rate falls >20% below initial.
 */
function guytonKlinger(
  prevSpend: number,
  portfolio: number,
  lastReturn: number,
  refSpend: number,
  p0: number,
  inflation: number,
  yearsLeft: number,
): number {
  if (portfolio <= 0 || p0 <= 0) return prevSpend * (1 + inflation);
  const initWR = refSpend / p0;
  let spend = prevSpend * (1 + inflation);
  // Modified Withdrawal Rule.
  if (lastReturn < 0 && spend / portfolio > initWR) spend = prevSpend;
  const wr = spend / portfolio;
  // Capital Preservation (cut) / Prosperity (raise) — mutually exclusive.
  if (yearsLeft > 15 && wr > 1.2 * initWR) spend *= 0.9;
  else if (wr < 0.8 * initWR) spend *= 1.1;
  return spend;
}

export function projectLifetime(household: Household, assumptions: ProjectionResultInput): ProjectionResult {
  const { strategy, bracketTarget, returnRate, inflationRate, endAge, convert, survivor, returnFor, futureRateOverride } =
    assumptions;
  const heirTaxRate = assumptions.heirTaxRate ?? ASSUMED_LIQUIDATION_RATE;
  const h = cloneHousehold(household);
  // A genuinely single household (never-married / no living spouse) is encoded by
  // the absence of a real spouse — the app's convention is spouse.birthYear <= 1900
  // (see app/projection/page.tsx hasSpouse). Such a person must file SINGLE for the
  // ENTIRE projection (never MFJ), and the widow's-penalty transition must NOT run
  // for them (no spending cut, no "keep the larger SS" — they were always single).
  // Without this, a single retiree is silently taxed on the MFJ curve for life
  // (double-width brackets, 2× standard deduction, 2× IRMAA headroom), which
  // overstates the estate by hundreds of thousands and understates lifetime tax.
  const isSingle = !(household.spouse && household.spouse.birthYear > 1900);
  const startYear = new Date().getFullYear();
  const rows: ProjectionRow[] = [];
  let lifetimeTax = 0;
  let lifetimeTaxReal = 0; // same, in today's (start-year) dollars
  let depleted = false;
  let totalConverted = 0;
  let lifetimeIrmaa = 0; // cumulative Medicare IRMAA surcharges — a real cash drag
  let lifetimeIrmaaReal = 0;
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
  // Per-holding dividend model: when taxable holdings carry real dividend data
  // (DPS auto-filled from the market feed / entered), derive this year's dividend
  // income from shares × DPS and GROW it at the modeled dividend-growth path —
  // NOT at the price return. Income then tracks (a) the modeled DPS growth and
  // (b) how many shares are still held (shareFraction, which only moves when the
  // brokerage is actually sold/reinvested, never from price). Falls back to the
  // entered household totals scaled by balance when there's no holdings data.
  const taxableHoldings = h.accounts.filter((a) => bucketOf(a.kind) === "taxable").flatMap((a) => a.holdings ?? []);
  const divModel = dividendBreakdown(taxableHoldings);
  const useDivModel = divModel.hasData;
  const HORIZON = 62; // loop runs startYear .. startYear+60
  const qualFactor: number[] = [];
  const ordFactor: number[] = [];
  if (useDivModel) {
    for (let t = 0; t < HORIZON; t++) {
      qualFactor.push(bucketGrowthFactor(taxableHoldings, "qualified", t));
      ordFactor.push(bucketGrowthFactor(taxableHoldings, "ordinary", t));
    }
  }
  let shareFraction = 1; // fraction of the original dividend-paying position still held
  const brokBalNow = () => h.accounts.filter(isBrokerage).reduce((s, a) => s + a.balance, 0);

  const baseDivQ = useDivModel ? divModel.qualifiedYear0 : household.brokerageDividendsAnnual;
  const baseDivO = useDivModel ? divModel.ordinaryYear0 : (household.ordinaryDividendsAnnual ?? 0);
  const baseInt = household.taxableInterestAnnual ?? 0;
  const baseMuni = household.taxExemptInterestAnnual ?? 0;
  const initBrokerage = h.accounts.filter(isBrokerage).reduce((s, a) => s + a.balance, 0);
  const initCash = h.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);

  // Guyton-Klinger references: initial spend (W0) and initial portfolio (P0) set
  // the planning withdrawal rate the guardrails defend. refSpend is dropped at the
  // survivor transition so the rate recenters on the survivor's lower baseline.
  const useGuardrails = assumptions.spendingStrategy === "guardrails";
  const flatNominal = assumptions.spendingStrategy === "flatNominal";
  const W0 = h.annualSpending;
  const P0 = h.accounts.reduce((s, a) => s + a.balance, 0);
  let refSpend = W0; // the intended real spend (steps down at the survivor transition)
  let minSpendRatio = Infinity; // lowest (actual real spend ÷ intended) — guardrail cut depth
  // Cumulative price level — the inflation index applied to brackets/IRMAA and the
  // real-dollar deflator. Built as a PRODUCT of each year's REALIZED inflation
  // (constant when inflationFor is absent; a stochastic AR(1) path under Monte
  // Carlo), so every inflation-sensitive site moves together off one number.
  const inflationFor = assumptions.inflationFor;
  let priceLevel = 1;

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

    // Inflation index for this year (= cumulative price level at its START). The
    // tax engine uses it to index brackets, deductions, and IRMAA tiers, and it
    // doubles as the real-dollar deflator below — one number, no drift.
    const inflationFactor = priceLevel;

    // Tax drag: scale this year's investment income with the current balances.
    const curBrokerage = h.accounts.filter(isBrokerage).reduce((s, a) => s + a.balance, 0);
    const curCash = h.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
    const divFactor = initBrokerage > 0 ? curBrokerage / initBrokerage : 1;
    const intFactor = initCash > 0 ? curCash / initCash : 1;
    if (useDivModel) {
      // Modeled DPS growth × shares still held. shareFraction is updated below,
      // when this year's withdrawals/reinvestment actually change the position.
      const t = year - startYear;
      h.brokerageDividendsAnnual = baseDivQ * (qualFactor[t] ?? qualFactor[qualFactor.length - 1] ?? 1) * shareFraction;
      h.ordinaryDividendsAnnual = baseDivO * (ordFactor[t] ?? ordFactor[ordFactor.length - 1] ?? 1) * shareFraction;
    } else {
      h.brokerageDividendsAnnual = baseDivQ * divFactor;
      h.ordinaryDividendsAnnual = baseDivO * divFactor;
    }
    h.taxExemptInterestAnnual = baseMuni * divFactor;
    h.taxableInterestAnnual = baseInt * intFactor;

    // Survivor transition: apply the one-time changes the first year on/after the
    // older spouse's death — keep the larger SS, stop the smaller, inherit the
    // pre-tax (spousal rollover), and drop spending to the survivor factor.
    const isSurvivorYear = !isSingle && survivor != null && year >= firstDeathYear;
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
      refSpend *= survivor.spendingFactor; // recenter the guardrail rate on the survivor's lower spend
    }
    const filingStatus = isSingle || isSurvivorYear ? ("single" as const) : ("mfj" as const);

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
      dividendMode: assumptions.dividendMode,
    });
    magiByYear.set(year, plan.tax.magi);

    // Apply withdrawals. pretax draw includes the RMD.
    drawFromBucket(h.accounts, "pretax", plan.withdrawals.pretax);
    // Track how much of the dividend-paying (non-cash) position the taxable draw
    // actually sells — cash-first means small draws sell zero brokerage, so they
    // don't cut the dividend. Price growth never moves shareFraction.
    const brokBeforeDraw = useDivModel ? brokBalNow() : 0;
    drawFromBucket(h.accounts, "taxable", plan.withdrawals.taxable);
    if (useDivModel && brokBeforeDraw > 0) shareFraction *= brokBalNow() / brokBeforeDraw;
    drawFromBucket(h.accounts, "roth", plan.withdrawals.roth);

    // Roll pre-tax → Roth (tax paid from taxable/cash). Shrinks future RMDs.
    if (plan.conversion > 0) {
      applyConversion(h.accounts, plan.conversion, plan.conversionTax);
      totalConverted += plan.conversion;
    }

    // The Medicare IRMAA premium is a real out-of-pocket cash cost this year — it
    // isn't an income tax, so it's NOT inside plan.tax.totalTax or netCash. Pay it
    // from savings now so those dollars leave the compounding base, exactly like
    // spending and income tax already do. A forced-RMD surplus (netCash above the
    // spending need) covers it first; any remainder is drawn from savings cash-first.
    const irmaaCost = plan.tax.irmaa.householdAnnual;
    const leftover = plan.netCash - plan.spendingTarget; // forced-RMD surplus, before the premium
    const reinvestAmt = Math.max(0, leftover - irmaaCost);
    const premiumFromSavings = Math.max(0, irmaaCost - Math.max(0, leftover));
    if (reinvestAmt > 0) {
      const brokBeforeReinvest = useDivModel ? brokBalNow() : 0;
      reinvestSurplus(h.accounts, reinvestAmt);
      if (useDivModel && brokBeforeReinvest > 0) shareFraction *= brokBalNow() / brokBeforeReinvest;
    } else if (premiumFromSavings > 0) {
      const brokBeforePremium = useDivModel ? brokBalNow() : 0;
      drawFromBucket(h.accounts, "taxable", premiumFromSavings);
      if (useDivModel && brokBeforePremium > 0) shareFraction *= brokBalNow() / brokBeforePremium;
    }

    // Cut depth = actual real spend vs. the intended real spend (refSpend already
    // includes the survivor step-down), so constant-real reads 0 cut and only
    // guardrail-driven trims below plan count.
    if (refSpend > 0) minSpendRatio = Math.min(minSpendRatio, plan.spendingTarget / inflationFactor / refSpend);
    lifetimeTax += plan.tax.totalTax;
    lifetimeIrmaa += plan.tax.irmaa.householdAnnual;
    // Deflate to today's dollars by this year's price level (same index used for
    // brackets — a tax paid in year T is worth less in real terms).
    lifetimeTaxReal += plan.tax.totalTax / inflationFactor;
    lifetimeIrmaaReal += plan.tax.irmaa.householdAnnual / inflationFactor;
    peakRmd = Math.max(peakRmd, plan.rmd);
    if (plan.rmd > 0) peakRmdMarginal = Math.max(peakRmdMarginal, plan.tax.marginalOrdinaryRate);
    peakMarginalRate = Math.max(peakMarginalRate, plan.tax.marginalOrdinaryRate);

    growAll(h.accounts, returnFor ? returnFor(year - startYear) : returnRate);
    // In "spend" mode the brokerage's dividends/interest were received as cash this
    // year (funding spending), so carve them out of its total-return growth — leaving
    // them to also compound would double-count vs. a tax-free Roth. In the default
    // "reinvest" mode they were NOT taken as cash, so they stay invested and compound
    // (their tax is still owed — covered by a slightly larger withdrawal instead).
    if (assumptions.dividendMode === "spend") {
      distributeFromBrokerage(
        h.accounts,
        (h.brokerageDividendsAnnual ?? 0) + (h.ordinaryDividendsAnnual ?? 0) + (h.taxExemptInterestAnnual ?? 0),
      );
    }

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
      inflationFactor,
      irmaa: plan.tax.irmaa.householdAnnual,
      netCash: plan.netCash,
      spendingTarget: plan.spendingTarget,
      startBalances,
      endTotal,
      shortfall: plan.shortfall > 1,
    });

    if (plan.shortfall > 1 && !depleted) depleted = true;

    // This year's realized inflation (stochastic under MC, else the flat rate) and
    // return — used to grow next year's spending/COLA and advance the price level.
    const yearReturn = returnFor ? returnFor(year - startYear) : returnRate;
    const yearInfl = inflationFor ? inflationFor(year - startYear) : inflationRate;
    if (useGuardrails) {
      h.annualSpending = guytonKlinger(h.annualSpending, endTotal, yearReturn, refSpend, P0, yearInfl, endAge - selfAge);
    } else if (flatNominal) {
      // "Flat" = the SAME dollar amount every year. Spending does NOT grow, so its
      // real purchasing power erodes with inflation (an opt-in for those who want it).
    } else {
      // Default: constant REAL spending — grow the nominal amount with inflation so
      // the lifestyle stays the same year to year.
      h.annualSpending *= 1 + yearInfl;
    }
    // Social Security COLA (tracks realized inflation, like the indexed brackets).
    h.self = { ...h.self, socialSecurityAnnual: h.self.socialSecurityAnnual * (1 + yearInfl) };
    h.spouse = { ...h.spouse, socialSecurityAnnual: h.spouse.socialSecurityAnnual * (1 + yearInfl) };
    priceLevel *= 1 + yearInfl; // advance to next year's start
  }

  const endPretax = h.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((s, a) => s + a.balance, 0);
  const endRoth = h.accounts.filter((a) => bucketOf(a.kind) === "roth").reduce((s, a) => s + a.balance, 0);
  const endTaxable = h.accounts.filter((a) => bucketOf(a.kind) === "taxable").reduce((s, a) => s + a.balance, 0);
  const endTaxableGain = h.accounts
    .filter((a) => bucketOf(a.kind) === "taxable")
    .reduce((s, a) => s + Math.max(0, a.balance - (a.costBasis ?? a.balance)), 0);

  const endingEstate = endPretax + endRoth + endTaxable;
  // Leftover pre-tax is a deferred tax bill (income in respect of a decedent — it
  // does NOT get a step-up). A non-spouse heir must drain it within 10 years
  // (SECURE Act), so we value it at the HEIR's assumed marginal bracket spread
  // over that window (default 24%), not the original owner's RMD rate.
  const liquidationRate = heirTaxRate;
  // Brokerage assets get a STEP-UP IN BASIS at death (IRC §1014): the embedded
  // unrealized gain is forgiven, so heirs inherit at full value and owe $0 income
  // tax on it. Roth is already tax-free. (Heirs selling later realize only
  // post-death gains, ~$0 at the moment of death.)
  // The lifetime Medicare IRMAA surcharges are NOT subtracted here — they are now
  // paid as a real cash outflow from savings each year (see the loop above), so the
  // remaining balances already reflect them. lifetimeIrmaa is kept only as a
  // reported cost line. Floor at 0: a depleted plan leaves a $0 estate.
  const endingEstateAfterTax = Math.max(0, endPretax * (1 - liquidationRate) + endRoth + endTaxable);

  // Today's-dollars versions: the ending estate sits at the final modeled year, so
  // deflate it by that many years of inflation.
  // Final cumulative price level (built from realized inflation) deflates the
  // ending estate to today's dollars — matches the per-year deflation above.
  const endDeflator = priceLevel;
  const endingEstateReal = endingEstate / endDeflator;
  const endingEstateAfterTaxReal = endingEstateAfterTax / endDeflator; // already floored at 0

  // Years funded before the first shortfall (for ranking failing plans by how long
  // they last — "runs dry at 86" should rank below "runs dry at 95"). Equals the
  // full horizon when the plan never falls short.
  const firstShortfallIdx = rows.findIndex((r) => r.shortfall);
  const solventYears = firstShortfallIdx < 0 ? rows.length : firstShortfallIdx;

  return {
    rows,
    lifetimeTax,
    lifetimeTaxReal,
    lifetimeIrmaa,
    lifetimeIrmaaReal,
    endingEstate,
    endingEstateReal,
    endingEstateAfterTax,
    endingEstateAfterTaxReal,
    endingBuckets: { pretax: endPretax, roth: endRoth, taxable: endTaxable, taxableGain: endTaxableGain },
    yearsModeled: rows.length,
    depleted,
    solventYears,
    minRealSpendRatio: minSpendRatio === Infinity ? 1 : Math.min(1, minSpendRatio),
    totalConverted,
    peakRmd,
    peakMarginalRate,
    futureRate,
    survivorYear,
  };
}

// Alias kept readable in the function signature above.
type ProjectionResultInput = ProjectionAssumptions;
