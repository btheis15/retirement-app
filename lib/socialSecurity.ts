/**
 * Social Security claiming math (per person).
 *
 * The benefit you enter is treated as your Primary Insurance Amount (PIA) — the
 * benefit at your Full Retirement Age (FRA). Claiming earlier permanently
 * REDUCES it; delaying past FRA (up to age 70) permanently INCREASES it via
 * delayed-retirement credits. These factors are set by SSA statute.
 *
 *  - Reduction: 5/9 of 1% per month for the first 36 months early, then
 *    5/12 of 1% per month beyond that (→ 70% of PIA at 62 when FRA is 67).
 *  - Credits: 2/3 of 1% per month after FRA, i.e. +8%/year (→ 124% at 70).
 *
 * The RETIREMENT EARNINGS TEST is modeled here too (earningsTestWithholding /
 * arfAdjustedClaimAge): claim before FRA while still earning wages and SSA
 * withholds $1 of benefits per $2 earned over an annual exempt amount ($1 per
 * $3 in the calendar year you reach FRA, counting only pre-FRA months) — and
 * then, at FRA, permanently RAISES the check as if you'd claimed later by the
 * number of withheld months (the "adjustment of the reduction factor", ARF).
 * Withheld ≠ lost; it's deferred.
 *
 * Modeling conventions (each errs in a stated direction):
 *  - No birth months exist in the model (ages are year − birthYear), so the
 *    FRA-year regime is placed in the calendar year containing the fractional
 *    FRA point. For the 1960+ cohort (integer FRA 67) that collapses to "the
 *    year you turn 67 is already test-free" — understates FRA-year withholding
 *    slightly; ARF pays withheld months back, so the lifetime bias is ≈ 0.
 *  - The FRA-year test assumes earnings arrive evenly through the year.
 *  - Withholding is dollar-exact rather than whole-check (SSA withholds whole
 *    checks then settles up — same annual total, smoother here).
 *  - Exempt amounts are indexed by the plan's price level (statutorily they
 *    follow the national Average Wage Index, which usually outpaces CPI — so
 *    future-year withholding is slightly OVERstated).
 *  - Only the earner's OWN retirement benefit is tested. Spousal/dependent
 *    benefits (not modeled) would also be withheld in reality.
 *
 * ⚠️ Educational estimates only. Ignores cost-of-living adjustments (COLA — the
 * projection layers its own) and the exact spousal/survivor benefit rules.
 */

export const CLAIM_MIN = 62;
export const CLAIM_MAX = 70;

/** Full Retirement Age in years (can be fractional, e.g. 66.5) by birth year. */
export function fullRetirementAge(birthYear: number): number {
  if (birthYear <= 1954) return 66;
  if (birthYear >= 1960) return 67;
  return 66 + ((birthYear - 1954) * 2) / 12; // +2 months per year for 1955–1959
}

/** Benefit as a fraction of PIA for a claim age (≈0.70 at 62 up to ≈1.24 at 70). */
export function ssBenefitFactor(birthYear: number, claimAge: number): number {
  const fra = fullRetirementAge(birthYear);
  const a = Math.min(CLAIM_MAX, Math.max(CLAIM_MIN, claimAge));
  if (a < fra) {
    const monthsEarly = Math.round((fra - a) * 12);
    const first = Math.min(36, monthsEarly);
    const beyond = Math.max(0, monthsEarly - 36);
    const reduction = first * (5 / 9 / 100) + beyond * (5 / 12 / 100);
    return 1 - reduction;
  }
  if (a > fra) {
    const monthsLate = Math.round((a - fra) * 12);
    return 1 + monthsLate * (2 / 3 / 100); // +8%/yr
  }
  return 1;
}

/** Annual benefit at a claim age, given the PIA (full-retirement-age) benefit. */
export function adjustedAnnualBenefit(piaAnnual: number, birthYear: number, claimAge: number): number {
  return Math.max(0, piaAnnual) * ssBenefitFactor(birthYear, claimAge);
}

// ─── The retirement earnings test ────────────────────────────────────────────

import { SS_EARNINGS_TEST_2026 } from "./tax/constants";

export interface EarningsTestParams {
  /** This year's claim-adjusted, COLA'd annual benefit (what would arrive with
   *  no test). 0 → nothing to withhold. */
  grossBenefit: number;
  /** This person's OWN earned income this year, nominal (already prorated for a
   *  stop year). Unearned income never counts. */
  earnings: number;
  birthYear: number;
  /** Calendar year being tested. */
  year: number;
  /** Price level for the year (indexes the exempt amounts; default 1). */
  inflationFactor?: number;
  /** Months actually worked this year, 1–12 (12 unless it's the stop year).
   *  Triggers the GRACE-YEAR monthly rule: in the year you retire mid-year,
   *  benefits for the non-working months are payable in full no matter how
   *  much the working months earned — so withholding is capped at the working
   *  months' share of the benefit. */
  monthsWorked?: number;
}

export interface EarningsTestResult {
  withheld: number;
  /** grossBenefit − withheld — the checks that actually arrive (and the only
   *  part that's taxable). */
  payable: number;
  /** Withheld dollars expressed in months of benefit — what ARF credits back
   *  at FRA. */
  monthsWithheldEquivalent: number;
  regime: "none" | "underFra" | "fraYear";
}

/** The calendar year the earnings test stops applying to this person (they are
 *  at/after FRA for the whole modeled year from here on). */
export function earningsTestEndYear(birthYear: number): number {
  return Math.ceil(birthYear + fullRetirementAge(birthYear));
}

/**
 * SSA's retirement earnings test for one person-year. Under FRA all year:
 * $1 withheld per $2 earned over the annual exempt amount. In the calendar
 * year FRA is reached: $1 per $3 over the (much higher) FRA-year exempt
 * amount, counting only the months before FRA. From FRA on: no test.
 * 2026 exempt amounts per the SSA COLA fact sheet; indexed by inflationFactor.
 */
export function earningsTestWithholding(p: EarningsTestParams): EarningsTestResult {
  const f = p.inflationFactor ?? 1;
  const none: EarningsTestResult = { withheld: 0, payable: Math.max(0, p.grossBenefit), monthsWithheldEquivalent: 0, regime: "none" };
  if (p.grossBenefit <= 0 || p.earnings <= 0) return { ...none, regime: p.year >= earningsTestEndYear(p.birthYear) ? "none" : none.regime };

  const fraPoint = p.birthYear + fullRetirementAge(p.birthYear);
  const fraCalendarYear = Math.floor(fraPoint);
  let regime: EarningsTestResult["regime"];
  if (p.year >= earningsTestEndYear(p.birthYear)) regime = "none";
  else if (p.year === fraCalendarYear) regime = "fraYear";
  else regime = "underFra";
  if (regime === "none") return none;

  let withheld: number;
  let cap = p.grossBenefit;
  if (regime === "underFra") {
    const exempt = SS_EARNINGS_TEST_2026.annualExemptUnderFra * f;
    withheld = Math.max(0, p.earnings - exempt) * SS_EARNINGS_TEST_2026.withholdRatioUnderFra;
  } else {
    // Months before the FRA point in its calendar year (e.g. FRA 66y8mo → 8).
    const monthsBeforeFra = Math.round((fraPoint - fraCalendarYear) * 12);
    if (monthsBeforeFra <= 0) return none;
    const testedEarnings = p.earnings * (monthsBeforeFra / 12); // even-earning assumption
    const exempt = SS_EARNINGS_TEST_2026.annualExemptFraYear * f;
    withheld = Math.max(0, testedEarnings - exempt) * SS_EARNINGS_TEST_2026.withholdRatioFraYear;
    cap = p.grossBenefit * (monthsBeforeFra / 12); // only pre-FRA checks can be held
  }
  // Grace year: a mid-year retiree keeps every non-working month's check.
  const monthsWorked = Math.min(12, Math.max(0, p.monthsWorked ?? 12));
  if (monthsWorked < 12) cap = Math.min(cap, p.grossBenefit * (monthsWorked / 12));

  withheld = Math.min(withheld, cap);
  const monthly = p.grossBenefit / 12;
  return {
    withheld,
    payable: p.grossBenefit - withheld,
    monthsWithheldEquivalent: monthly > 0 ? withheld / monthly : 0,
    regime,
  };
}

/**
 * ARF — at FRA, SSA recomputes the early-claim reduction as if you'd claimed
 * later by the number of months your benefits were withheld: the permanent
 * "you get it back" half of the earnings test. Never adjusts past FRA.
 */
export function arfAdjustedClaimAge(claimAge: number, monthsWithheld: number, birthYear: number): number {
  const fra = fullRetirementAge(birthYear);
  if (claimAge >= fra || monthsWithheld <= 0) return claimAge;
  return Math.min(fra, claimAge + monthsWithheld / 12);
}

/**
 * Nominal cumulative-dollars breakeven age between an earlier claim (ageA) and a
 * later claim (ageB > ageA): the age at which the bigger-but-later checks have
 * paid out more in total than the smaller-but-earlier ones. No COLA/discounting,
 * so it's a rule-of-thumb, not a guarantee.
 */
export function breakevenAge(piaAnnual: number, birthYear: number, ageA: number, ageB: number): number | null {
  const bA = adjustedAnnualBenefit(piaAnnual, birthYear, ageA);
  const bB = adjustedAnnualBenefit(piaAnnual, birthYear, ageB);
  if (bB <= bA) return null;
  // bA*(t-ageA) = bB*(t-ageB)  →  t = (bB*ageB - bA*ageA) / (bB - bA)
  return (bB * ageB - bA * ageA) / (bB - bA);
}
