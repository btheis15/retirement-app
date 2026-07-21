/**
 * AUDIT PROBE — the Social Security retirement earnings test (pure functions).
 * Run: npx tsx scripts/_audit_ss_earnings_test.mts
 *
 * 2026 exempt amounts verified against the SSA 2026 COLA fact sheet
 * (ssa.gov/news/en/cola/factsheets/2026.html, ssa.gov/oact/cola/rtea.html):
 * $24,480 under FRA ($1 withheld per $2 over) · $65,160 in the FRA calendar
 * year ($1 per $3, pre-FRA months only).
 *
 * Hand math:
 *  A. Benefit $24,000, wages $40,000, born 1964 (FRA 67), year 2026 (age 62):
 *     withheld = (40,000 − 24,480)/2 = $7,760 → payable 16,240; months
 *     equivalent = 7,760 / 2,000 = 3.88.
 *  B. Wages ≤ exempt → 0. Wages $80,000 → (80,000−24,480)/2 = 27,760, capped
 *     at the full $24,000 benefit.
 *  C. FRA year, born 1958 (FRA 66y8mo → fraPoint 2024.667): year 2024 tests
 *     8/12 of earnings. Earnings $120,000 → tested $80,000 → (80,000−65,160)/3
 *     = $4,946.67; cap = 8/12 × benefit. Born 1964 in 2031 (age 67) → no test.
 *  D. Grace year: benefit $24,000, wages $100,000 but monthsWorked 6 → annual
 *     rule says min(24,000, 37,760) but the monthly rule caps at 6/12 × 24,000
 *     = $12,000 (the six retired months' checks are untouchable).
 *  E. ARF: claim 62, born 1964; 24 months withheld → adjusted claim age 64 →
 *     factor 0.70 → 0.80 (36 months early × 5/9%). Never adjusts past FRA.
 *  F. Exempt amounts index with inflationFactor.
 */
import {
  earningsTestWithholding,
  arfAdjustedClaimAge,
  earningsTestEndYear,
  ssBenefitFactor,
} from "../lib/socialSecurity.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// A — under-FRA basic case
const a = earningsTestWithholding({ grossBenefit: 24_000, earnings: 40_000, birthYear: 1964, year: 2026 });
check("A: regime underFra", a.regime === "underFra");
check("A: withheld $7,760", near(a.withheld, 7_760), `${a.withheld}`);
check("A: payable $16,240", near(a.payable, 16_240), `${a.payable}`);
check("A: 3.88 months withheld", near(a.monthsWithheldEquivalent, 3.88), `${a.monthsWithheldEquivalent}`);

// B — under and over the caps
check("B: earnings at the exempt amount → 0", earningsTestWithholding({ grossBenefit: 24_000, earnings: 24_480, birthYear: 1964, year: 2026 }).withheld === 0);
const b = earningsTestWithholding({ grossBenefit: 24_000, earnings: 80_000, birthYear: 1964, year: 2026 });
check("B: capped at the whole benefit", near(b.withheld, 24_000) && b.payable === 0, `${b.withheld}`);

// C — FRA-year regime (fractional FRA cohort) and the 1960+ collapse
const c1 = earningsTestWithholding({ grossBenefit: 24_000, earnings: 120_000, birthYear: 1958, year: 2024 });
check("C: 1958 in 2024 → fraYear regime", c1.regime === "fraYear");
check("C: withheld (80,000−65,160)/3 = 4,946.67", near(c1.withheld, 4_946.67, 0.5), `${c1.withheld.toFixed(2)}`);
check("C: 1958 in 2025 → test-free", earningsTestWithholding({ grossBenefit: 24_000, earnings: 120_000, birthYear: 1958, year: 2025 }).regime === "none");
check("C: 1964 at age 67 (2031) → test-free", earningsTestWithholding({ grossBenefit: 24_000, earnings: 120_000, birthYear: 1964, year: 2031 }).regime === "none");
check("C: endYear 1958 → 2025, 1964 → 2031", earningsTestEndYear(1958) === 2025 && earningsTestEndYear(1964) === 2031);
// FRA-year cap: only pre-FRA checks can be held
const c2 = earningsTestWithholding({ grossBenefit: 24_000, earnings: 600_000, birthYear: 1958, year: 2024 });
check("C: FRA-year cap = 8/12 of the benefit", near(c2.withheld, 16_000), `${c2.withheld}`);

// D — grace-year monthly rule
const d = earningsTestWithholding({ grossBenefit: 24_000, earnings: 100_000, birthYear: 1964, year: 2026, monthsWorked: 6 });
check("D: mid-year retiree keeps the retired months ($12,000 cap)", near(d.withheld, 12_000), `${d.withheld}`);
check("D: months equivalent = 6", near(d.monthsWithheldEquivalent, 6), `${d.monthsWithheldEquivalent}`);

// E — ARF
check("E: 24 withheld months: claim 62 → 64", arfAdjustedClaimAge(62, 24, 1964) === 64);
check("E: factor 0.70 → 0.80", near(ssBenefitFactor(1964, 62), 0.7) && near(ssBenefitFactor(1964, arfAdjustedClaimAge(62, 24, 1964)), 0.8));
check("E: never past FRA", arfAdjustedClaimAge(62, 600, 1964) === 67);
check("E: no withholding → unchanged", arfAdjustedClaimAge(62, 0, 1964) === 62);
check("E: claimed at/after FRA → unchanged", arfAdjustedClaimAge(67, 24, 1964) === 67);

// F — inflation indexing of the exempt amounts
const f = earningsTestWithholding({ grossBenefit: 24_000, earnings: 40_000, birthYear: 1964, year: 2026, inflationFactor: 1.1 });
check("F: indexed exempt (40,000 − 26,928)/2 = 6,536", near(f.withheld, 6_536), `${f.withheld}`);

// G — no benefit or no earnings → nothing to do
check("G: no benefit → 0", earningsTestWithholding({ grossBenefit: 0, earnings: 90_000, birthYear: 1964, year: 2026 }).withheld === 0);
check("G: no earnings → 0", earningsTestWithholding({ grossBenefit: 24_000, earnings: 0, birthYear: 1964, year: 2026 }).withheld === 0);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
