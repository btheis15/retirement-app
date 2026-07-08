/**
 * AUDIT PROBE 8+9 — Illinois state tax and inflation indexing.
 * Run: npx tsx scripts/_audit_tax_il_inflation.mts
 *
 * Illinois hand math (flat 4.95%; personal exemption 2,925/person indexed;
 * senior +1,000/65+ fixed; exemption CLIFF to $0 above AGI 500k MFJ / 250k single):
 *  A) MFJ 2×65+, pretax 100,000, SS 40,000, interest 10,000, qd 5,000, LTCG 20,000:
 *     IL base = 10,000+5,000+20,000 = 35,000 (retirement exempt)
 *     exemption = 2×2,925 + 2×1,000 = 7,850 → taxable 27,150 → tax = 1,343.925
 *  B) same but pretax 0 → identical IL tax (retirement adds $0)
 *  C) AGI just over 500,000 → exemption 0 → tax = 35,000×4.95% = 1,732.50 (cliff, not phaseout)
 *  D) AGI exactly 500,000 → exemption still applies (statute: disallowed only when AGI EXCEEDS limit)
 *  E) Single 65+: exemption = 2,925 + 1,000 = 3,925; cliff at 250,000
 *
 * Inflation hand math (f = 1.5):
 *  F) MFJ ordinary 200,000 gross: deductions = 32,200×1.5 = 48,300 → TI 151,700
 *     brackets ×1.5 → 10% to 37,200, 12% to 151,200:
 *     tax = 3,720 + 0.12×114,000 + 0.22×500 = 3,720+13,680+110 = 17,510
 *  G) SS thresholds NOT indexed: taxable SS same at f=1 and f=1.5
 *  H) NIIT threshold NOT indexed: NIIT same at f=1 and f=1.5
 *  I) senior bonus NOT indexed: MFJ 2×65+ MAGI 200k, f=1.5 →
 *     deductions = 48,300 + 1,650×1.5×2 + (12,000 − 0.06×50,000) = 48,300+4,950+9,000 = 62,250
 *  J) IL personal exemption indexed, senior $1,000 fixed:
 *     f=1.5 → exemption = 2×2,925×1.5 + 2×1,000 = 10,775
 */
import { computeTaxes } from "../lib/tax/engine.ts";
import { computeStateTax } from "../lib/tax/state.ts";

let fails = 0;
function check(name: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(3)}, expected ${want.toFixed(3)}`);
}
const base = {
  otherOrdinaryIncome: 0, preTaxWithdrawals: 0, socialSecurity: 0,
  qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0, num65Plus: 0,
};

const A = computeTaxes({ ...base, preTaxWithdrawals: 100_000, socialSecurity: 40_000, taxableInterest: 10_000, qualifiedDividends: 5_000, longTermGains: 20_000, num65Plus: 2, state: "IL" });
check("A IL tax (retirement exempt, investment taxed)", A.stateTax, 1_343.925);
check("A IL exemption", A.state.exemption, 7_850);

const B = computeTaxes({ ...base, socialSecurity: 40_000, taxableInterest: 10_000, qualifiedDividends: 5_000, longTermGains: 20_000, num65Plus: 2, state: "IL" });
check("B pretax 100k → 0 vs A: IL tax identical", B.stateTax, A.stateTax, 1e-9);

const C = computeStateTax({ agi: 500_001, taxableInterest: 10_000, ordinaryDividends: 0, qualifiedDividends: 5_000, longTermGains: 20_000, num65Plus: 2, filingStatus: "mfj" });
check("C MFJ AGI 500,001 → exemption cliff to 0", C.exemption, 0);
check("C tax with no exemption", C.tax, 35_000 * 0.0495);
const D = computeStateTax({ agi: 500_000, taxableInterest: 10_000, ordinaryDividends: 0, qualifiedDividends: 5_000, longTermGains: 20_000, num65Plus: 2, filingStatus: "mfj" });
check("D MFJ AGI exactly 500,000 → exemption kept (cliff is strict >)", D.exemption, 7_850);
// prove cliff (no partial amount just above the line)
const C2 = computeStateTax({ agi: 510_000, taxableInterest: 10_000, ordinaryDividends: 0, qualifiedDividends: 5_000, longTermGains: 20_000, num65Plus: 2, filingStatus: "mfj" });
check("cliff not phaseout: AGI 510k exemption also exactly 0", C2.exemption, 0);

const E = computeStateTax({ agi: 200_000, taxableInterest: 10_000, ordinaryDividends: 0, qualifiedDividends: 0, longTermGains: 0, num65Plus: 1, filingStatus: "single" });
check("E single exemption 2,925+1,000", E.exemption, 3_925);
const E2 = computeStateTax({ agi: 250_001, taxableInterest: 10_000, ordinaryDividends: 0, qualifiedDividends: 0, longTermGains: 0, num65Plus: 1, filingStatus: "single" });
check("E single cliff at 250,001", E2.exemption, 0);

// ordinary dividends taxed by IL too
const OD = computeStateTax({ agi: 100_000, taxableInterest: 0, ordinaryDividends: 10_000, qualifiedDividends: 0, longTermGains: 0, num65Plus: 0, filingStatus: "mfj" });
check("IL taxes ordinary dividends (base 10,000 − 5,850 exemption)", OD.tax, (10_000 - 5_850) * 0.0495);

// ---- inflation indexing ----
const F = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, inflationFactor: 1.5, state: "none" });
check("F f=1.5 deductions 48,300", F.deductions, 48_300);
check("F f=1.5 ordinaryTax 17,510", F.ordinaryTax, 17_510);

const G1 = computeTaxes({ ...base, otherOrdinaryIncome: 20_000, socialSecurity: 40_000, state: "none" });
const G15 = computeTaxes({ ...base, otherOrdinaryIncome: 20_000, socialSecurity: 40_000, inflationFactor: 1.5, state: "none" });
check("G SS thresholds NOT indexed (taxable SS same, = 4,000)", G15.taxableSocialSecurity, G1.taxableSocialSecurity, 1e-9);
check("G value", G1.taxableSocialSecurity, 4_000);

const H1 = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, taxableInterest: 30_000, longTermGains: 40_000, state: "none" });
const H15 = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, taxableInterest: 30_000, longTermGains: 40_000, inflationFactor: 1.5, state: "none" });
check("H NIIT threshold NOT indexed (760 at both factors)", H15.niit, H1.niit, 1e-9);

const I = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, num65Plus: 2, inflationFactor: 1.5, state: "none" });
check("I senior bonus NOT indexed: total deductions 62,250", I.deductions, 62_250);

const J = computeStateTax({ agi: 100_000, taxableInterest: 20_000, ordinaryDividends: 0, qualifiedDividends: 0, longTermGains: 0, num65Plus: 2, filingStatus: "mfj", inflationFactor: 1.5 });
check("J IL exemption: personal indexed, senior fixed → 10,775", J.exemption, 10_775);

// LTCG brackets indexed: f=1.5 → 0% band top 148,350; ord TI 0, gains 148,350 → 0 tax
const L = computeTaxes({ ...base, otherOrdinaryIncome: 48_300, longTermGains: 148_350, inflationFactor: 1.5, state: "none" });
check("LTCG 0% ceiling indexed to 148,350", L.capitalGainsTax, 0);
const L2 = computeTaxes({ ...base, otherOrdinaryIncome: 48_300, longTermGains: 148_360, inflationFactor: 1.5, state: "none" });
check("next 10 gain dollars → 15%", L2.capitalGainsTax, 1.5);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll IL/inflation checks passed");
