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
 * ⚠️ Educational estimates only. Ignores cost-of-living adjustments (COLA), the
 * earnings test, and the exact spousal/survivor benefit rules.
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
