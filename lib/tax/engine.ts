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
  ORDINARY_BRACKETS_MFJ,
  LTCG_BRACKETS_MFJ,
  STANDARD_DEDUCTION_MFJ,
  ADDL_STD_DEDUCTION_65,
  SENIOR_BONUS_DEDUCTION,
  SENIOR_BONUS_PHASEOUT_RATE,
  SENIOR_BONUS_PHASEOUT_START_MFJ,
  SS_BASE_MFJ,
  SS_SECOND_MFJ,
  NIIT_RATE,
  NIIT_THRESHOLD_MFJ,
  IRMAA_TIERS_MFJ,
} from "./constants";

export interface TaxInput {
  /** Fully-taxable ordinary income that is NOT a pre-tax retirement withdrawal:
   *  pensions, annuities, wages, taxable interest. */
  otherOrdinaryIncome: number;
  /** Pre-tax retirement withdrawals (Traditional IRA / 401k / rollover), incl.
   *  RMDs. Taxed as ordinary income. */
  preTaxWithdrawals: number;
  /** Gross Social Security benefits (household). Up to 85% becomes taxable. */
  socialSecurity: number;
  /** Qualified dividends (preferential rates). */
  qualifiedDividends: number;
  /** Net long-term capital gains realized (preferential rates). */
  longTermGains: number;
  /** Taxable interest already counted in otherOrdinaryIncome? No — pass the
   *  interest portion separately here so NIIT can see it. Set 0 if none. */
  taxableInterest: number;
  /** Number of spouses age 65+ (0, 1, or 2) — drives the extra deductions. */
  num65Plus: number;
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
  totalTax: number;
  /** Marginal ordinary bracket rate at this income. */
  marginalOrdinaryRate: number;
  /** Marginal rate on the next dollar of long-term gains. */
  capitalGainsRate: number;
  /** Overall effective rate = totalTax / (AGI + nontaxable SS), guarded. */
  effectiveRate: number;
  irmaa: { perPerson: number; householdAnnual: number; label: string };
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

/** Marginal ordinary rate at a given ordinary taxable income. */
function ordinaryMarginalRate(ordinaryTaxableIncome: number): number {
  for (const b of ORDINARY_BRACKETS_MFJ) {
    if (ordinaryTaxableIncome <= b.upTo) return b.rate;
  }
  return ORDINARY_BRACKETS_MFJ[ORDINARY_BRACKETS_MFJ.length - 1].rate;
}

/**
 * Taxable portion of Social Security (MFJ), via the IRS "provisional income"
 * worksheet. `otherIncome` is everything in AGI except SS itself (ordinary +
 * preferential income), plus any tax-exempt interest.
 */
export function taxableSocialSecurity(ssBenefits: number, otherIncome: number): number {
  if (ssBenefits <= 0) return 0;
  const provisional = otherIncome + 0.5 * ssBenefits;
  if (provisional <= SS_BASE_MFJ) return 0;

  if (provisional <= SS_SECOND_MFJ) {
    return Math.min(0.5 * ssBenefits, 0.5 * (provisional - SS_BASE_MFJ));
  }
  // Above the second threshold: 85% of the excess over $44k, plus the smaller
  // of (the tier-1 amount) or $6,000 — capped at 85% of total benefits.
  const tier1 = Math.min(0.5 * (SS_SECOND_MFJ - SS_BASE_MFJ), 6_000);
  const taxable = 0.85 * (provisional - SS_SECOND_MFJ) + Math.min(tier1, 0.5 * ssBenefits);
  return Math.min(taxable, 0.85 * ssBenefits);
}

function seniorBonusDeduction(num65Plus: number, magi: number): number {
  if (num65Plus <= 0) return 0;
  // The OBBBA senior bonus phases out PER FILER: each eligible spouse's $6,000 is
  // reduced by 6% of MAGI over $150k (MFJ), so a couple's combined $12,000 is
  // fully gone at $250k MAGI (not $350k). Phasing the combined amount at a single
  // 6% understates the phaseout and leaves a phantom deduction near $250k.
  const over = Math.max(0, magi - SENIOR_BONUS_PHASEOUT_START_MFJ);
  const perFiler = Math.max(0, SENIOR_BONUS_DEDUCTION - over * SENIOR_BONUS_PHASEOUT_RATE);
  return perFiler * num65Plus;
}

function irmaaFor(magi: number) {
  for (const tier of IRMAA_TIERS_MFJ) {
    if (magi <= tier.upTo) {
      return {
        perPerson: tier.monthlyPerPerson,
        householdAnnual: tier.monthlyPerPerson * 12 * 2,
        label: tier.label,
      };
    }
  }
  const last = IRMAA_TIERS_MFJ[IRMAA_TIERS_MFJ.length - 1];
  return { perPerson: last.monthlyPerPerson, householdAnnual: last.monthlyPerPerson * 12 * 2, label: last.label };
}

export function computeTaxes(input: TaxInput): TaxResult {
  const ordinaryGross = input.otherOrdinaryIncome + input.preTaxWithdrawals;
  const preferential = Math.max(0, input.qualifiedDividends + input.longTermGains);

  // SS taxability depends on all other income (ordinary + preferential).
  const otherForSS = ordinaryGross + preferential;
  const taxableSS = taxableSocialSecurity(input.socialSecurity, otherForSS);

  const agi = ordinaryGross + preferential + taxableSS;
  const magi = agi; // tax-exempt interest not modeled → MAGI ≈ AGI

  // Deductions: base standard + extra-for-65 (per spouse) + senior bonus.
  const deductions =
    STANDARD_DEDUCTION_MFJ +
    ADDL_STD_DEDUCTION_65 * input.num65Plus +
    seniorBonusDeduction(input.num65Plus, magi);

  const taxableIncome = Math.max(0, agi - deductions);

  // Preferential income stacks on TOP of ordinary income. Deductions come off
  // ordinary income first.
  const preferentialInTaxable = Math.min(preferential, taxableIncome);
  const ordinaryTaxableIncome = Math.max(0, taxableIncome - preferentialInTaxable);

  const ordinaryTax = applyBrackets(ordinaryTaxableIncome, ORDINARY_BRACKETS_MFJ);

  // Capital-gains tax: gains fill the LTCG brackets, but stacked above ordinary
  // taxable income — so tax = brackets(ordinary + pref) − brackets(ordinary).
  const capStackTop = applyBrackets(ordinaryTaxableIncome + preferentialInTaxable, LTCG_BRACKETS_MFJ);
  const capStackBottom = applyBrackets(ordinaryTaxableIncome, LTCG_BRACKETS_MFJ);
  const capitalGainsTax = Math.max(0, capStackTop - capStackBottom);

  // NIIT: 3.8% on the lesser of net investment income or MAGI over $250k.
  const netInvestmentIncome = input.qualifiedDividends + input.longTermGains + input.taxableInterest;
  const niit = NIIT_RATE * Math.max(0, Math.min(netInvestmentIncome, magi - NIIT_THRESHOLD_MFJ));

  const totalTax = ordinaryTax + capitalGainsTax + niit;

  // Marginal rate on the next dollar of LT gains: find the LTCG bracket the
  // top of the preferential stack currently sits in.
  let capitalGainsRate = 0;
  let cursor = ordinaryTaxableIncome + preferentialInTaxable;
  for (const b of LTCG_BRACKETS_MFJ) {
    if (cursor < b.upTo) { capitalGainsRate = b.rate; break; }
  }

  const grossIncomeForEffective = agi + (input.socialSecurity - taxableSS);
  const effectiveRate = grossIncomeForEffective > 0 ? totalTax / grossIncomeForEffective : 0;

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
    totalTax,
    marginalOrdinaryRate: ordinaryMarginalRate(ordinaryTaxableIncome),
    capitalGainsRate,
    effectiveRate,
    irmaa: irmaaFor(magi),
  };
}

/** Top of the ordinary bracket whose rate is `rate` (for "fill to here" logic). */
export function ordinaryBracketCeiling(rate: number): number {
  const b = ORDINARY_BRACKETS_MFJ.find((x) => x.rate === rate);
  return b ? b.upTo : Infinity;
}

/** The taxable-income ceiling that keeps long-term gains in the 0% band. */
export const LTCG_ZERO_CEILING = LTCG_BRACKETS_MFJ[0].upTo;
