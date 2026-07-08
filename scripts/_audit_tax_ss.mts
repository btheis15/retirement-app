/**
 * AUDIT PROBE 3 — Social Security taxability worksheet (MFJ 32k/44k, Single 25k/34k).
 * Run: npx tsx scripts/_audit_tax_ss.mts
 *
 * Hand math (MFJ, base 32,000 / second 44,000, tier1 cap 6,000):
 *  A) SS 40,000, other 10,000: prov = 30,000 ≤ 32,000 → 0
 *  B) SS 40,000, other 12,000: prov = 32,000 (exactly base) → 0
 *  C) SS 40,000, other 20,000: prov = 40,000 → min(20,000, 0.5×8,000) = 4,000
 *  D) SS 10,000, other 38,000: prov = 43,000 → min(5,000, 0.5×11,000=5,500) = 5,000 (50%-of-benefit cap binds)
 *  E) SS 40,000, other 24,000: prov = 44,000 (exactly second) → min(20,000, 0.5×12,000) = 6,000
 *  F) SS 40,000, other 40,000: prov = 60,000 → 0.85×16,000 + min(6,000, 20,000) = 13,600+6,000 = 19,600 (< 34,000 cap)
 *  G) SS 20,000, other 100,000: prov = 110,000 → 0.85×66,000 + 6,000 = 62,100 → cap 0.85×20,000 = 17,000
 * Hand math (Single, base 25,000 / second 34,000, statutory tier1 cap 4,500 = 0.5×(34,000−25,000)):
 *  H) SS 20,000, other 30,000: prov = 40,000 → 0.85×6,000 + min(4,500, 10,000) = 5,100+4,500 = 9,600
 *     (a 6,000 hard-coded tier1 WITHOUT the 0.5×(second−base) min would give 11,100 — bug detector)
 *  I) SS 8,000, other 26,000: prov = 30,000 → min(4,000, 0.5×5,000) = 2,500
 *  J) SS 15,000, other 200,000: 85% cap → 12,750
 *  K) muni interest counts in provisional income: SS 40,000 (MFJ), other 0, muni 25,000:
 *     prov = 25,000 + 20,000 = 45,000 → 0.85×1,000 + min(6,000, 20,000) = 850+6,000 = 6,850
 */
import { taxableSocialSecurity, computeTaxes } from "../lib/tax/engine.ts";

let fails = 0;
function check(name: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(2)}, expected ${want.toFixed(2)}`);
}

const MFJ = [32_000, 44_000] as const;
const SGL = [25_000, 34_000] as const;

check("A MFJ below base", taxableSocialSecurity(40_000, 10_000, ...MFJ), 0);
check("B MFJ exactly at base", taxableSocialSecurity(40_000, 12_000, ...MFJ), 0);
check("C MFJ in 50% band", taxableSocialSecurity(40_000, 20_000, ...MFJ), 4_000);
check("D MFJ 50%-of-benefits cap binds", taxableSocialSecurity(10_000, 38_000, ...MFJ), 5_000);
check("E MFJ exactly at second threshold", taxableSocialSecurity(40_000, 24_000, ...MFJ), 6_000);
check("F MFJ above second, below 85% cap", taxableSocialSecurity(40_000, 40_000, ...MFJ), 19_600);
check("G MFJ 85% cap binds", taxableSocialSecurity(20_000, 100_000, ...MFJ), 17_000);
check("H Single above second — tier1 must cap at 4,500 not 6,000", taxableSocialSecurity(20_000, 30_000, ...SGL), 9_600);
check("I Single in 50% band", taxableSocialSecurity(8_000, 26_000, ...SGL), 2_500);
check("J Single 85% cap", taxableSocialSecurity(15_000, 200_000, ...SGL), 12_750);
check("SS=0 → 0", taxableSocialSecurity(0, 500_000, ...MFJ), 0);

// K — engine-level: muni interest raises provisional income
const k = computeTaxes({
  otherOrdinaryIncome: 0, preTaxWithdrawals: 0, socialSecurity: 40_000,
  qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0,
  taxExemptInterest: 25_000, num65Plus: 2, state: "none",
});
check("K engine: muni in provisional income", k.taxableSocialSecurity, 6_850);

// engine wiring: single status uses single thresholds
const s = computeTaxes({
  otherOrdinaryIncome: 30_000, preTaxWithdrawals: 0, socialSecurity: 20_000,
  qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0,
  num65Plus: 1, filingStatus: "single", state: "none",
});
check("engine single-status thresholds (case H via engine)", s.taxableSocialSecurity, 9_600);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll SS worksheet checks passed");
