/**
 * AUDIT PROBE 10 — Social Security claiming math (lib/socialSecurity.ts).
 * Run: npx tsx scripts/_audit_tax_ssclaim.mts
 *
 * Hand math (SSA statute):
 *  FRA: born ≤1954 → 66; 1955 → 66y2m (66.1667); 1959 → 66y10m; ≥1960 → 67.
 *  Early reduction: 5/9% per month (first 36) + 5/12% per month beyond.
 *   born 1960, claim 62: 60 months early → 36×5/9% = 20% ; 24×5/12% = 10% → factor 0.70
 *   born 1960, claim 65: 24 months early → 24×5/9% = 13.333% → 0.866667
 *   born 1960, claim 64: 36 months early → 20% → 0.80
 *   born 1954, claim 62: 48 months early → 20% + 12×5/12%=5% → 0.75
 *  Delayed credits: 2/3% per month (8%/yr):
 *   born 1960, claim 70: 36 months → +24% → 1.24
 *   born 1954, claim 70: 48 months → +32% → 1.32
 *  Clamps: claim 58 treated as 62; claim 75 treated as 70.
 *  Breakeven 62 vs 70 (born 1960): t = (1.24×70 − 0.70×62)/(1.24−0.70) = 43.4/0.54 = 80.370
 */
import { fullRetirementAge, ssBenefitFactor, adjustedAnnualBenefit, breakevenAge } from "../lib/socialSecurity.ts";

let fails = 0;
function check(name: string, got: number | null, want: number | null, tol = 1e-6) {
  const ok = got !== null && want !== null && Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, expected ${want}`);
}

check("FRA born 1954", fullRetirementAge(1954), 66);
check("FRA born 1955", fullRetirementAge(1955), 66 + 2 / 12);
check("FRA born 1959", fullRetirementAge(1959), 66 + 10 / 12);
check("FRA born 1960", fullRetirementAge(1960), 67);
check("FRA born 1975", fullRetirementAge(1975), 67);

check("factor born 1960 claim 62 = 0.70", ssBenefitFactor(1960, 62), 0.70);
check("factor born 1960 claim 64 = 0.80", ssBenefitFactor(1960, 64), 0.80);
check("factor born 1960 claim 65 = 0.8667", ssBenefitFactor(1960, 65), 1 - 24 * (5 / 9 / 100));
check("factor born 1960 claim 67 (FRA) = 1", ssBenefitFactor(1960, 67), 1);
check("factor born 1960 claim 70 = 1.24", ssBenefitFactor(1960, 70), 1.24);
check("factor born 1954 claim 62 = 0.75", ssBenefitFactor(1954, 62), 0.75);
check("factor born 1954 claim 70 = 1.32", ssBenefitFactor(1954, 70), 1.32);
check("clamp below 62", ssBenefitFactor(1960, 58), ssBenefitFactor(1960, 62));
check("clamp above 70", ssBenefitFactor(1960, 75), ssBenefitFactor(1960, 70));

check("adjusted benefit 40,000 PIA @62 (born 1960)", adjustedAnnualBenefit(40_000, 1960, 62), 28_000);
check("adjusted benefit 40,000 PIA @70 (born 1960)", adjustedAnnualBenefit(40_000, 1960, 70), 49_600);
check("negative PIA floored", adjustedAnnualBenefit(-5_000, 1960, 67), 0);

check("breakeven 62 vs 70, born 1960 ≈ 80.370", breakevenAge(40_000, 1960, 62, 70), 43.4 / 0.54, 1e-3);
check("breakeven null when later claim not bigger", breakevenAge(40_000, 1960, 70, 70) === null ? 1 : 0, 1);

// fractional FRA path: born 1957 (FRA 66.5), claim 62 → 54 months early
// 36×5/9% + 18×5/12% = 20% + 7.5% → 0.725
check("factor born 1957 claim 62 = 0.725", ssBenefitFactor(1957, 62), 0.725);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll SS claiming checks passed");
console.log("NOTE: spousal/survivor benefit rules are documented as NOT modeled in socialSecurity.ts (survivor keeps larger check in projection.ts).");
