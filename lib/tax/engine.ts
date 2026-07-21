/**
 * Federal tax engine (MFJ) — pure functions, no I/O.
 *
 * The hard part of retirement-withdrawal tax planning is that everything is
 * coupled: a dollar pulled from a pre-tax IRA can also make more of your Social
 * Security taxable AND push capital gains from the 0% into the 15% band. So we
 * compute the WHOLE picture in one place rather than taxing each source alone.
 *
 * ⚠️ Educational estimates only — not tax advice. Federal only; no state tax.
 */

import {
  SENIOR_BONUS_DEDUCTION,
  SENIOR_BONUS_PHASEOUT_RATE,
  NIIT_RATE,
  FILING_CONSTANTS,
  FilingStatus,
} from "./constants";
import { computeStateTax, StateCode, StateTaxResult } from "./state";

export interface TaxInput {
  /** Fully-taxable ordinary RETIREMENT income that is NOT a pre-tax withdrawal:
   *  pensions and annuities. (Wages go in `wages` — Illinois exempts this field
   *  but taxes wages, so the two must stay separate.) */
  otherOrdinaryIncome: number;
  /** W-2 / self-employment EARNED income. Federal ordinary income (raises the
   *  taxable share of Social Security, MAGI/IRMAA, and the senior-bonus
   *  phaseout like any other ordinary dollar) AND state-taxable in Illinois —
   *  unlike every retirement field here. FICA/SE payroll tax is handled by the
   *  caller (it isn't an income tax). */
  wages?: number;
  /** Pre-tax retirement withdrawals (Traditional IRA / 401k / rollover), incl.
   *  RMDs. Taxed as ordinary income. */
  preTaxWithdrawals: number;
  /** Gross Social Security benefits (household). Up to 85% becomes taxable. */
  socialSecurity: number;
  /** Qualified dividends (preferential rates). */
  qualifiedDividends: number;
  /** Net long-term capital gains realized (preferential rates). */
  longTermGains: number;
  /** Taxable interest (CDs/Treasuries/savings). Ordinary income + NIIT. Pass
   *  separately (NOT folded into otherOrdinaryIncome) so it's added once here. */
  taxableInterest: number;
  /** Ordinary / non-qualified dividends (REITs, bond funds). Ordinary income + NIIT. */
  ordinaryDividends?: number;
  /** Tax-exempt (municipal) interest — not taxed, but raises MAGI (IRMAA, NIIT
   *  threshold, senior-deduction phaseout) and the SS provisional-income test. */
  taxExemptInterest?: number;
  /** Number of spouses age 65+ (0, 1, or 2) — drives the extra deductions AND,
   *  since Medicare eligibility is age 65, the number of people who pay IRMAA. */
  num65Plus: number;
  /** Calendar/tax year. Gates the OBBBA senior bonus (2025–2028 only). Default 2026. */
  year?: number;
  /** MAGI to use for the IRMAA lookup. IRMAA for premium year T is statutorily set
   *  by MAGI from year T−2, so a projection passes the 2-years-prior MAGI here.
   *  Omitted → uses this year's MAGI (the single-year planner's awareness estimate). */
  irmaaMagi?: number;
  /** State of residence for state income tax. Defaults to Illinois. */
  state?: StateCode;
  /** Filing status — "single" models a surviving spouse. Defaults to "mfj". */
  filingStatus?: FilingStatus;
  /** Internal: skip the effective-marginal-rate finite difference (prevents the
   *  one-level recursion from recursing further). */
  _noMarginal?: boolean;
  /**
   * Inflation index for THIS year relative to the base year, e.g. 1.28 for ~10
   * years at 2.5%. Brackets, deductions, IRMAA tiers, and the senior-bonus
   * phaseout are scaled by it so nominal income and nominal brackets move
   * together (no "bracket creep"). The Social Security taxability thresholds and
   * the NIIT threshold are statutorily NOT indexed, so they stay fixed. Default 1.
   */
  inflationFactor?: number;
}

export interface TaxResult {
  /** Taxable portion of Social Security. */
  taxableSocialSecurity: number;
  /** Adjusted gross income. */
  agi: number;
  /** Modified AGI (≈ AGI here; used for NIIT/IRMAA/senior-deduction phaseout). */
  magi: number;
  /** Total deductions applied (standard + age-65 + senior bonus after phaseout). */
  deductions: number;
  /** Taxable income after deductions. */
  taxableIncome: number;
  /** Taxable income taxed at ordinary rates (excludes preferential gains/divs). */
  ordinaryTaxableIncome: number;
  /** Preferential income (LTCG + qualified dividends) within taxable income. */
  preferentialIncome: number;
  ordinaryTax: number;
  capitalGainsTax: number;
  niit: number;
  /** Federal tax only (ordinary + capital gains + NIIT). */
  federalTax: number;
  /** State income tax (Illinois by default). */
  stateTax: number;
  /** Full state-tax detail (rate, exemption, what's exempt). */
  state: StateTaxResult;
  /** Total tax burden = federal + state. */
  totalTax: number;
  /** Marginal ordinary bracket rate at this income. */
  marginalOrdinaryRate: number;
  /** Marginal rate on the next dollar of long-term gains. */
  capitalGainsRate: number;
  /** Overall effective rate = totalTax / (AGI + nontaxable SS), guarded. */
  effectiveRate: number;
  /** TRUE marginal cost of the next dollar of ordinary income (federal + state),
   *  by finite difference — captures the Social Security "tax torpedo," NIIT, and
   *  the senior-bonus phaseout, which the statutory bracket rate alone misses.
   *  This is what rate-arbitrage conversion decisions should compare. */
  effectiveMarginalRate: number;
  irmaa: {
    perPerson: number;
    householdAnnual: number;
    label: string;
    /** Index into the filing status's IRMAA tier table (0 = standard premium,
     *  no surcharge). −1 when nobody is on Medicare yet. Lets downstream code
     *  detect tier CROSSINGS without comparing inflation-moving dollars. */
    tierIndex: number;
  };
}

/** Apply a progressive bracket table to an amount. */
function applyBrackets(amount: number, brackets: { rate: number; upTo: number }[]): number {
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (amount <= prev) break;
    const slice = Math.min(amount, b.upTo) - prev;
    tax += slice * b.rate;
    prev = b.upTo;
  }
  return tax;
}

/** Marginal ordinary rate at a given ordinary taxable income. When unused
 *  deductions would absorb the next dollar (taxable income pinned at 0), the
 *  true statutory marginal rate is 0%, not the first bracket's 10%. `slack` is
 *  the unused-deduction headroom (deductions − AGI, when positive). */
function ordinaryMarginalRate(
  ordinaryTaxableIncome: number,
  brackets: { rate: number; upTo: number }[],
  slack = 0,
): number {
  if (ordinaryTaxableIncome <= 0 && slack > 0) return 0;
  for (const b of brackets) {
    if (ordinaryTaxableIncome <= b.upTo) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

/** Scale a progressive bracket table's boundaries by an inflation factor. */
function indexedBrackets(brackets: { rate: number; upTo: number }[], factor: number) {
  if (factor === 1) return brackets;
  return brackets.map((b) => ({ rate: b.rate, upTo: b.upTo === Infinity ? Infinity : b.upTo * factor }));
}

/**
 * Taxable portion of Social Security (MFJ), via the IRS "provisional income"
 * worksheet. `otherIncome` is everything in AGI except SS itself (ordinary +
 * preferential income), plus any tax-exempt interest.
 */
export function taxableSocialSecurity(ssBenefits: number, otherIncome: number, ssBase: number, ssSecond: number): number {
  if (ssBenefits <= 0) return 0;
  const provisional = otherIncome + 0.5 * ssBenefits;
  if (provisional <= ssBase) return 0;

  if (provisional <= ssSecond) {
    return Math.min(0.5 * ssBenefits, 0.5 * (provisional - ssBase));
  }
  // Above the second threshold: 85% of the excess over the second threshold, plus
  // the smaller of (the tier-1 amount) or $6,000 — capped at 85% of total benefits.
  const tier1 = Math.min(0.5 * (ssSecond - ssBase), 6_000);
  const taxable = 0.85 * (provisional - ssSecond) + Math.min(tier1, 0.5 * ssBenefits);
  return Math.min(taxable, 0.85 * ssBenefits);
}

function seniorBonusDeduction(num65Plus: number, agi: number, phaseoutStart: number, year: number): number {
  if (num65Plus <= 0) return 0;
  // OBBBA section 70103: the $6,000-per-filer senior bonus exists ONLY for tax
  // years 2025–2028. After that it disappears entirely (only the permanent
  // age-65 additional standard deduction remains).
  if (year > 2028) return 0;
  // The $6,000 amount and the $150k MFJ / $75k single phaseout thresholds are
  // STATUTORY FIXED dollars — they are NOT inflation-indexed. OBBBA sec. 70103
  // reduces the AGGREGATE deduction (the combined $6,000 × eligible filers) by 6%
  // of MAGI over the threshold ONCE — not each filer's $6,000 independently. So for
  // an MFJ couple with both spouses 65+, the combined $12,000 phases out over a
  // $150k–$350k band, not $150k–$250k. (Single filers are unchanged — one filer
  // means per-filer == aggregate.)
  const gross = SENIOR_BONUS_DEDUCTION * num65Plus;
  const over = Math.max(0, agi - phaseoutStart);
  return Math.max(0, gross - over * SENIOR_BONUS_PHASEOUT_RATE);
}

export function irmaaFor(
  magi: number,
  factor: number,
  tiers: { upTo: number; monthlyPerPerson: number; label: string }[],
  enrollees: number, // people age 65+ on Medicare this year (pre-65 → 0 → no IRMAA)
) {
  if (enrollees <= 0) return { perPerson: 0, householdAnnual: 0, label: "Not yet on Medicare", tierIndex: -1 };
  // Both the MAGI thresholds AND the surcharge dollars are indexed by the
  // inflation factor: CMS re-sets the premium amounts every year alongside the
  // brackets, so billing 2026 surcharge dollars in 2050 would understate
  // late-life IRMAA (and bias comparisons toward high-RMD "do nothing" paths).
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (magi <= tier.upTo * factor) {
      return {
        perPerson: tier.monthlyPerPerson * factor,
        householdAnnual: tier.monthlyPerPerson * factor * 12 * enrollees,
        label: tier.label,
        tierIndex: i,
      };
    }
  }
  const last = tiers[tiers.length - 1];
  return {
    perPerson: last.monthlyPerPerson * factor,
    householdAnnual: last.monthlyPerPerson * factor * 12 * enrollees,
    label: last.label,
    tierIndex: tiers.length - 1,
  };
}

export function computeTaxes(input: TaxInput): TaxResult {
  const ordinaryDividends = input.ordinaryDividends ?? 0;
  const taxExemptInterest = input.taxExemptInterest ?? 0;
  // Inflation-index the brackets/deductions for this projection year so nominal
  // income and nominal brackets move together (no bracket creep). SS thresholds
  // and the NIIT threshold are statutorily NOT indexed, so they stay fixed.
  const f = input.inflationFactor ?? 1;
  const c = FILING_CONSTANTS[input.filingStatus ?? "mfj"];
  const ordBrackets = indexedBrackets(c.ordinary, f);
  const ltcgBrackets = indexedBrackets(c.ltcg, f);
  // Taxable interest, ordinary/REIT dividends, and wages are ordinary-rate income.
  const wages = input.wages ?? 0;
  const ordinaryGross = input.otherOrdinaryIncome + input.preTaxWithdrawals + input.taxableInterest + ordinaryDividends + wages;
  // Net capital LOSSES are out of scope: the planner only ever realizes gains
  // (sales use blended positive basis), so a negative sum is clamped rather than
  // modeling the §1211 $3,000 ordinary offset / carryforward.
  const preferential = Math.max(0, input.qualifiedDividends + input.longTermGains);

  // SS taxability uses all other income (ordinary + preferential) PLUS tax-exempt
  // (muni) interest — the IRS provisional-income worksheet adds it back.
  const otherForSS = ordinaryGross + preferential + taxExemptInterest;
  const taxableSS = taxableSocialSecurity(input.socialSecurity, otherForSS, c.ssBase, c.ssSecond);

  const agi = ordinaryGross + preferential + taxableSS;
  // Muni interest isn't taxed, and it counts in MAGI for IRMAA ONLY (42 U.S.C.
  // §1395r(i)(4) adds tax-exempt interest back). The NIIT threshold (§1411:
  // AGI + only §911 foreign exclusions) and the OBBBA senior-bonus phaseout
  // (§70103: same definition) do NOT add muni interest back — use `agi` there.
  const magi = agi + taxExemptInterest;

  // Deductions: base standard + extra-for-65 (per spouse, both indexed) + the
  // temporary OBBBA senior bonus (fixed dollars, 2025–2028 only).
  const year = input.year ?? 2026;
  const deductions =
    c.stdDeduction * f +
    c.addlStd65 * f * input.num65Plus +
    seniorBonusDeduction(input.num65Plus, agi, c.seniorBonusStart, year);

  const taxableIncome = Math.max(0, agi - deductions);

  // Preferential income stacks on TOP of ordinary income. Deductions come off
  // ordinary income first.
  const preferentialInTaxable = Math.min(preferential, taxableIncome);
  const ordinaryTaxableIncome = Math.max(0, taxableIncome - preferentialInTaxable);

  const ordinaryTax = applyBrackets(ordinaryTaxableIncome, ordBrackets);

  // Capital-gains tax: gains fill the LTCG brackets, but stacked above ordinary
  // taxable income — so tax = brackets(ordinary + pref) − brackets(ordinary).
  const capStackTop = applyBrackets(ordinaryTaxableIncome + preferentialInTaxable, ltcgBrackets);
  const capStackBottom = applyBrackets(ordinaryTaxableIncome, ltcgBrackets);
  const capitalGainsTax = Math.max(0, capStackTop - capStackBottom);

  // NIIT: 3.8% on the lesser of net investment income or MAGI over $250k. The
  // $250k threshold is statutory and NOT inflation-indexed (intentionally fixed).
  const netInvestmentIncome =
    input.qualifiedDividends + input.longTermGains + input.taxableInterest + ordinaryDividends;
  const niit = NIIT_RATE * Math.max(0, Math.min(netInvestmentIncome, agi - c.niitThreshold));

  const federalTax = ordinaryTax + capitalGainsTax + niit;

  // State income tax. Illinois exempts all retirement income (SS, pensions,
  // IRA/401k withdrawals, RMDs, Roth conversions), so its base is the investment
  // income below PLUS wages — earned income is fully IL-taxable, which is exactly
  // why wages must not ride in otherOrdinaryIncome.
  const state = computeStateTax(
    {
      agi,
      taxableInterest: input.taxableInterest,
      ordinaryDividends,
      qualifiedDividends: input.qualifiedDividends,
      longTermGains: input.longTermGains,
      wages,
      num65Plus: input.num65Plus,
      inflationFactor: f,
      filingStatus: input.filingStatus ?? "mfj",
    },
    input.state ?? "IL",
  );

  const totalTax = federalTax + state.tax;

  // Marginal rate on the next dollar of LT gains: find the LTCG bracket the
  // top of the preferential stack currently sits in.
  let capitalGainsRate = 0;
  const cursor = ordinaryTaxableIncome + preferentialInTaxable;
  for (const b of ltcgBrackets) {
    if (cursor < b.upTo) { capitalGainsRate = b.rate; break; }
  }

  // Denominator for the headline effective rate: all cash income actually
  // received this year — AGI plus the untaxed slice of SS plus muni interest.
  const grossIncomeForEffective = agi + (input.socialSecurity - taxableSS) + taxExemptInterest;
  const effectiveRate = grossIncomeForEffective > 0 ? totalTax / grossIncomeForEffective : 0;

  // TRUE marginal cost of the next ordinary dollar (e.g. a Roth conversion):
  // finite-difference the total tax for a $1,000 bump. This automatically folds
  // in the Social Security tax torpedo, NIIT, and the senior-bonus phaseout —
  // none of which the statutory bracket rate captures. (Illinois doesn't tax the
  // conversion, so its state component is ~0, which is correct.) IRMAA is handled
  // separately (it isn't an income tax and uses a 2-year MAGI lag).
  const deductionSlack = Math.max(0, deductions - agi);
  let effectiveMarginalRate = ordinaryMarginalRate(ordinaryTaxableIncome, ordBrackets, deductionSlack);
  if (!input._noMarginal) {
    const dx = 1_000;
    const bumped = computeTaxes({ ...input, preTaxWithdrawals: input.preTaxWithdrawals + dx, _noMarginal: true });
    effectiveMarginalRate = Math.max(0, (bumped.totalTax - totalTax) / dx);
  }

  return {
    taxableSocialSecurity: taxableSS,
    agi,
    magi,
    deductions,
    taxableIncome,
    ordinaryTaxableIncome,
    preferentialIncome: preferentialInTaxable,
    ordinaryTax,
    capitalGainsTax,
    niit,
    federalTax,
    stateTax: state.tax,
    state,
    totalTax,
    marginalOrdinaryRate: ordinaryMarginalRate(ordinaryTaxableIncome, ordBrackets, deductionSlack),
    capitalGainsRate,
    effectiveRate,
    effectiveMarginalRate,
    // IRMAA: charged only to Medicare enrollees (age 65+), so scale by num65Plus
    // (a 63/61 couple owes $0), and look it up against the 2-years-prior MAGI when
    // the caller supplies it (premium year T uses year T−2 income).
    irmaa: irmaaFor(input.irmaaMagi ?? magi, f, c.irmaaTiers, input.num65Plus),
  };
}

/** Top of the ordinary bracket whose rate is `rate` — a NOMINAL 2026 value for
 *  the given filing status. Callers in a projection must multiply by the year's
 *  inflationFactor (the tax engine indexes the brackets the same way). */
export function ordinaryBracketCeiling(rate: number, status: FilingStatus = "mfj"): number {
  const b = FILING_CONSTANTS[status].ordinary.find((x) => x.rate === rate);
  return b ? b.upTo : Infinity;
}

/**
 * Rate-arbitrage conversion ceiling: the income level at which the STATUTORY
 * marginal rate first reaches the projected future rate you're avoiding. Filling
 * pre-tax up to here converts only dollars taxed STRICTLY below that future cost —
 * so every converted dollar is cheaper now than it would be as a later RMD.
 *
 * `futureEffRate` is an EFFECTIVE rate (it folds in the Social-Security torpedo,
 * IRMAA, and NIIT), so it almost never equals a statutory bracket rate exactly —
 * we therefore compare against each bracket's rate rather than matching by equality
 * (the old exact-match version returned Infinity for any effective rate, which
 * silently disabled this ceiling). Returns a NOMINAL 2026 value; scale by the
 * year's inflationFactor in a projection.
 *
 * Examples (MFJ): a 24% future rate → top of the 22% bracket (converts 10/12/22,
 * a wash at 24% is excluded). A ~27% effective future rate → top of the 24%
 * bracket (24% < 27%, so the 24% bracket is still strictly cheaper and included).
 */
export function arbitrageCeiling(futureEffRate: number, status: FilingStatus = "mfj"): number {
  let prevTop = 0;
  for (const b of FILING_CONSTANTS[status].ordinary) {
    if (b.rate >= futureEffRate - 1e-9) return prevTop; // floor of the first bracket at/above the future rate
    prevTop = b.upTo;
  }
  return prevTop; // future rate sits above the top bracket → convert across all brackets
}

/** The taxable-income ceiling that keeps long-term gains in the 0% band (MFJ). */
export const LTCG_ZERO_CEILING = FILING_CONSTANTS.mfj.ltcg[0].upTo;

/** Status-aware 0%-LTCG ceiling — a NOMINAL 2026 value (scale by inflationFactor). */
export function ltcgZeroCeiling(status: FilingStatus = "mfj"): number {
  return FILING_CONSTANTS[status].ltcg[0].upTo;
}
