/**
 * AUDIT PROBE 1 — Ordinary bracket slicing (MFJ + Single), 2026 nominal.
 * Run: npx tsx scripts/_audit_tax_brackets.mts
 *
 * Hand math (MFJ, taxable 150,000):
 *   10% × 24,800                  =  2,480
 *   12% × (100,800 − 24,800)      =  9,120
 *   22% × (150,000 − 100,800)     = 10,824
 *   total                         = 22,424
 * Hand math (Single, taxable 150,000):
 *   10% × 12,400 = 1,240; 12% × 38,000 = 4,560; 22% × 55,300 = 12,166;
 *   24% × (150,000 − 105,700) = 10,632  → total 28,598
 * Hand math (MFJ, taxable 1,000,000):
 *   2,480 + 9,120 + 24,332 + 46,116 + 34,848 + 89,687.50 + 0.37×231,300(=85,581)
 *   = 292,164.50
 */
import { computeTaxes } from "../lib/tax/engine.ts";

let fails = 0;
function check(name: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(2)}, expected ${want.toFixed(2)}`);
}

// helper: pure ordinary income, no SS/gains/65+, so taxableIncome = other − stdDeduction
function ordTax(taxable: number, status: "mfj" | "single") {
  const std = status === "mfj" ? 32_200 : 16_100;
  return computeTaxes({
    otherOrdinaryIncome: taxable + std,
    preTaxWithdrawals: 0, socialSecurity: 0, qualifiedDividends: 0,
    longTermGains: 0, taxableInterest: 0, num65Plus: 0,
    filingStatus: status, state: "none",
  });
}

check("MFJ taxable 150,000 ordinaryTax", ordTax(150_000, "mfj").ordinaryTax, 22_424);
check("MFJ taxable 24,800 (exact 10% top)", ordTax(24_800, "mfj").ordinaryTax, 2_480);
check("MFJ taxable 24,801 (first 12% dollar)", ordTax(24_801, "mfj").ordinaryTax, 2_480.12);
check("MFJ taxable 1,000,000", ordTax(1_000_000, "mfj").ordinaryTax, 292_164.5);
check("MFJ taxable 0", ordTax(0, "mfj").ordinaryTax, 0);
check("Single taxable 150,000 ordinaryTax", ordTax(150_000, "single").ordinaryTax, 28_598);
check("Single taxable 12,400 (exact 10% top)", ordTax(12_400, "single").ordinaryTax, 1_240);
check("Single taxable 50,400", ordTax(50_400, "single").ordinaryTax, 1_240 + 4_560);

// marginal statutory rate readouts
check("MFJ marginal at TI 150,000 = 22%", ordTax(150_000, "mfj").marginalOrdinaryRate, 0.22, 1e-9);
check("MFJ marginal at TI 24,800 = 10% (boundary inclusive)", ordTax(24_800, "mfj").marginalOrdinaryRate, 0.10, 1e-9);
check("Single marginal at TI 150,000 = 24%", ordTax(150_000, "single").marginalOrdinaryRate, 0.24, 1e-9);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll bracket checks passed");
