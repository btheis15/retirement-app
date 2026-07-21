/**
 * AUDIT PROBE — wages through the tax engine (federal + Illinois).
 * Run: npx tsx scripts/_audit_tax_wages.mts
 *
 * Hand math (2026 MFJ, inflationFactor 1):
 *  A. Wages $120,000 + SS $30,000:
 *     provisional = 120,000 + ½·30,000 = 135,000 > $44,000 second threshold
 *     → taxable SS = min(0.85·30,000, 0.85·(135,000−44,000) + min(6,000, 15,000))
 *     = min(25,500, 83,350) = 25,500. AGI = 145,500.
 *     Illinois: wages ARE taxed (retirement income isn't): base 120,000 −
 *     exemption 2×2,925 = 114,150 → ×4.95% = 5,650.43.
 *  B. Same $120,000 as PENSION instead: federal identical (same ordinary
 *     income), Illinois $0 (retirement income exempt).
 *  C. Senior bonus phaseout on a wagey AGI: wages 200,000, both 65+ →
 *     bonus = 12,000 − 6%·(200,000−150,000) = 9,000; deductions =
 *     32,200 + 2×1,650 + 9,000 = 44,500.
 *  D. NIIT: wages 300,000 + LTG 50,000 → AGI 350,000; NII = 50,000 (wages are
 *     NOT investment income) → NIIT = 3.8%·min(50,000, 100,000) = 1,900.
 */
import { computeTaxes } from "../lib/tax/engine.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};
const base = {
  otherOrdinaryIncome: 0,
  preTaxWithdrawals: 0,
  socialSecurity: 0,
  qualifiedDividends: 0,
  longTermGains: 0,
  taxableInterest: 0,
  num65Plus: 0,
  year: 2026,
} as const;

// A — wages + SS
const a = computeTaxes({ ...base, wages: 120_000, socialSecurity: 30_000 });
check("A: taxable SS hits the 85% cap (25,500)", Math.abs(a.taxableSocialSecurity - 25_500) < 0.01, `${a.taxableSocialSecurity}`);
check("A: AGI = 145,500", Math.abs(a.agi - 145_500) < 0.01, `${a.agi}`);
check("A: IL taxes the wages (5,650.43)", Math.abs(a.state.tax - 5_650.43) < 0.5, `${a.state.tax.toFixed(2)}`);

// B — same dollars as pension: same federal, zero IL
const b = computeTaxes({ ...base, otherOrdinaryIncome: 120_000, socialSecurity: 30_000 });
check("B: federal identical to wages case", Math.abs(a.federalTax - b.federalTax) < 0.01, `${a.federalTax.toFixed(0)} vs ${b.federalTax.toFixed(0)}`);
check("B: IL exempts the pension ($0)", b.state.tax === 0, `${b.state.tax}`);

// C — senior-bonus phaseout driven by wage AGI
const c = computeTaxes({ ...base, wages: 200_000, num65Plus: 2 });
check("C: deductions 44,500 (32,200 + 3,300 + phased 9,000)", Math.abs(c.deductions - 44_500) < 0.01, `${c.deductions}`);

// D — NIIT: wages raise AGI over the threshold but are not investment income
const d = computeTaxes({ ...base, wages: 300_000, longTermGains: 50_000 });
check("D: NIIT = 1,900", Math.abs(d.niit - 1_900) < 0.01, `${d.niit}`);

// E — no-state mode: wages incur no state tax
const e = computeTaxes({ ...base, wages: 120_000, state: "none" });
check("E: state 'none' → $0 on wages", e.state.tax === 0);

// F — wages omitted behaves exactly as before (regression guard)
const f1 = computeTaxes({ ...base, preTaxWithdrawals: 90_000 });
const f2 = computeTaxes({ ...base, preTaxWithdrawals: 90_000, wages: 0 });
check("F: wages:0 ≡ wages omitted", f1.totalTax === f2.totalTax && f1.agi === f2.agi);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
