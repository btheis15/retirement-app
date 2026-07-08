/**
 * AUDIT PROBE 2 — Standard deduction + age-65 additional + OBBBA senior bonus phaseout.
 * Run: npx tsx scripts/_audit_tax_deductions.mts
 *
 * Hand math:
 *  MFJ both 65+, MAGI 200,000 (pure ordinary income, no muni):
 *    base 32,200 + 2×1,650 = 35,500
 *    bonus = 12,000 − 0.06×(200,000−150,000) = 12,000 − 3,000 = 9,000
 *    total deductions = 44,500
 *  MFJ both 65+, MAGI 350,000: bonus = 12,000 − 0.06×200,000 = 0 (fully phased out at exactly 350k)
 *  MFJ both 65+, MAGI 400,000: bonus = max(0, 12,000 − 15,000) = 0
 *  Year 2029: bonus = 0 (OBBBA 2025–2028 only) → deductions 35,500
 *  Single 65+, MAGI 100,000: 16,100 + 2,050 + (6,000 − 0.06×25,000 = 4,500) = 22,650
 *  Single 65+, MAGI 175,000: bonus = 6,000 − 6,000 = 0 → 18,150
 */
import { computeTaxes } from "../lib/tax/engine.ts";

let fails = 0;
function check(name: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(2)}, expected ${want.toFixed(2)}`);
}

const base = {
  preTaxWithdrawals: 0, socialSecurity: 0, qualifiedDividends: 0,
  longTermGains: 0, taxableInterest: 0, state: "none" as const,
};

check("MFJ 2x65+, MAGI 200k deductions",
  computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2 }).deductions, 44_500);
check("MFJ 2x65+, MAGI 150k (no phaseout) deductions",
  computeTaxes({ ...base, otherOrdinaryIncome: 150_000, num65Plus: 2 }).deductions, 47_500);
check("MFJ 2x65+, MAGI 350k (bonus fully gone)",
  computeTaxes({ ...base, otherOrdinaryIncome: 350_000, num65Plus: 2 }).deductions, 35_500);
check("MFJ 2x65+, MAGI 400k (clamped at 0, not negative)",
  computeTaxes({ ...base, otherOrdinaryIncome: 400_000, num65Plus: 2 }).deductions, 35_500);
check("MFJ 2x65+, MAGI 200k, year 2029 (bonus expired)",
  computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2, year: 2029 }).deductions, 35_500);
check("MFJ 2x65+, MAGI 200k, year 2028 (last bonus year)",
  computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2, year: 2028 }).deductions, 44_500);
check("MFJ 1x65+, MAGI 200k (aggregate = 6,000, same 6% aggregate phaseout)",
  computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 1 }).deductions,
  32_200 + 1_650 + Math.max(0, 6_000 - 3_000)); // 36,850
check("MFJ 0x65+, MAGI 200k (base only)",
  computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 0 }).deductions, 32_200);
check("Single 65+, MAGI 100k deductions",
  computeTaxes({ ...base, otherOrdinaryIncome: 100_000, num65Plus: 1, filingStatus: "single" }).deductions, 22_650);
check("Single 65+, MAGI 175k (bonus fully gone)",
  computeTaxes({ ...base, otherOrdinaryIncome: 175_000, num65Plus: 1, filingStatus: "single" }).deductions, 18_150);

// LAW CHECK: senior-bonus phaseout MAGI should be AGI + foreign exclusions only
// (OBBBA §70103 MAGI does NOT add back tax-exempt interest). Engine uses magi = agi + muni.
const noMuni = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2 });
const withMuni = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2, taxExemptInterest: 50_000 });
console.log(`\nINFO senior bonus, MFJ AGI 200k: no muni deductions=${noMuni.deductions} ; +50k muni deductions=${withMuni.deductions}`);
console.log("     Statute (§70103 MAGI = AGI + §911/931/933 only): both should be 44,500. Engine phases out an extra 0.06×50,000 = 3,000 when muni present.");
check("Senior bonus should NOT phase out on muni interest (statutory MAGI excludes it)", withMuni.deductions, 44_500);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll deduction checks passed");
