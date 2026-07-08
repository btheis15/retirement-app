/**
 * AUDIT PROBE 4+5 — LTCG stacking and NIIT.
 * Run: npx tsx scripts/_audit_tax_ltcg_niit.mts
 *
 * LTCG hand math (MFJ, 0% band top 98,900; 15% top 613,700; num65Plus=0, std 32,200):
 *  A) ordinary TI 50,000 (other = 82,200), LTCG 80,000:
 *     0% room left = 98,900 − 50,000 = 48,900; spill = 80,000 − 48,900 = 31,100 → ×15% = 4,665
 *     ordinaryTax on 50,000 = 2,480 + 0.12×25,200 = 5,504
 *  B) ordinary TI 50,000, LTCG 40,000 → stack top 90,000 < 98,900 → capGainsTax 0
 *  C) ordinary TI 150,000 (other = 182,200), LTCG 50,000 → all gains at 15% → 7,500
 *  D) ordinary TI 600,000 (other = 632,200), LTCG 100,000:
 *     ltcg(700,000) − ltcg(600,000) = [0.15×514,800 + 0.20×86,300] − 0.15×501,100
 *     = (77,220 + 17,260) − 75,165 = 19,315   (13,700@15% + 86,300@20%)
 *  E) Single: ordinary TI 30,000 (other = 46,100), LTCG 30,000:
 *     0% room = 49,450 − 30,000 = 19,450; spill 10,550 ×15% = 1,582.50
 *
 * NIIT hand math (rate 3.8%, MFJ threshold 250,000 / Single 200,000, NOT indexed):
 *  F) MFJ other 200,000, interest 30,000, LTCG 40,000 → AGI 270,000, NII 70,000
 *     → 3.8% × min(70,000, 20,000) = 760
 *  G) same + muni 50,000: NII must stay 70,000 (muni excluded from NII). STATUTORY
 *     NIIT MAGI (AGI + §911 only) = 270,000 → NIIT should STILL be 760.
 *     Engine magi = 320,000 → would give 3.8% × 70,000 = 2,660 if muni leaks into the threshold test.
 *  H) MFJ AGI below 250,000 → 0
 *  I) Single other 150,000, interest 30,000, LTCG 40,000 → AGI 220,000 → 3.8% × min(70,000, 20,000) = 760
 *  J) qualified + ordinary dividends and interest all in NII: MFJ other 250,000, qd 10,000, od 5,000, int 5,000
 *     AGI 270,000, NII 20,000 → 3.8% × min(20,000, 20,000) = 760
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
  longTermGains: 0, taxableInterest: 0, num65Plus: 0, state: "none" as const,
};

const A = computeTaxes({ ...base, otherOrdinaryIncome: 82_200, longTermGains: 80_000 });
check("A capGainsTax (partial 0% band, spill to 15%)", A.capitalGainsTax, 4_665);
check("A ordinaryTax unchanged by gains", A.ordinaryTax, 5_504);
check("A next-gain-dollar rate = 15%", A.capitalGainsRate, 0.15, 1e-9);

const B = computeTaxes({ ...base, otherOrdinaryIncome: 82_200, longTermGains: 40_000 });
check("B gains fully in 0% band", B.capitalGainsTax, 0);
check("B next-gain-dollar rate = 0%", B.capitalGainsRate, 0, 1e-9);

const C = computeTaxes({ ...base, otherOrdinaryIncome: 182_200, longTermGains: 50_000 });
check("C ordinary pushes all gains to 15%", C.capitalGainsTax, 7_500);

const D = computeTaxes({ ...base, otherOrdinaryIncome: 632_200, longTermGains: 100_000 });
check("D 20% band straddle", D.capitalGainsTax, 19_315);
check("D next-gain-dollar rate = 20%", D.capitalGainsRate, 0.20, 1e-9);

const E = computeTaxes({ ...base, otherOrdinaryIncome: 46_100, longTermGains: 30_000, filingStatus: "single" });
check("E single 0%→15% spill", E.capitalGainsTax, 1_582.5);

// identity: capitalGainsTax = ltcg(ord+pref) − ltcg(ord); verify difference-vs-standalone
// standalone taxation of the same gains starting at 0 would be 0 here — confirm stacking matters
const Cstandalone = computeTaxes({ ...base, otherOrdinaryIncome: 32_200, longTermGains: 50_000 });
check("stacking sanity: same 50k gains with no ordinary income → 0% band", Cstandalone.capitalGainsTax, 0);

// qualified dividends stack identically to LTCG
const Aqd = computeTaxes({ ...base, otherOrdinaryIncome: 82_200, qualifiedDividends: 80_000 });
check("qualified dividends stack like LTCG", Aqd.capitalGainsTax, 4_665);

// ---- NIIT ----
const F = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, taxableInterest: 30_000, longTermGains: 40_000 });
check("F NIIT = 3.8% × min(NII, MAGI−250k)", F.niit, 760);

const G = computeTaxes({ ...base, otherOrdinaryIncome: 200_000, taxableInterest: 30_000, longTermGains: 40_000, taxExemptInterest: 50_000 });
console.log(`\nINFO G: engine NIIT with 50k muni = ${G.niit.toFixed(2)} (statute: 760 — NIIT MAGI does not add back tax-exempt interest)`);
check("G muni must not raise NIIT (statutory NIIT MAGI = AGI)", G.niit, 760);

const H = computeTaxes({ ...base, otherOrdinaryIncome: 150_000, taxableInterest: 30_000, longTermGains: 40_000 });
check("H MFJ AGI 220k < 250k → NIIT 0", H.niit, 0);

const I = computeTaxes({ ...base, otherOrdinaryIncome: 150_000, taxableInterest: 30_000, longTermGains: 40_000, filingStatus: "single" });
check("I Single threshold 200k", I.niit, 760);

const J = computeTaxes({ ...base, otherOrdinaryIncome: 250_000, qualifiedDividends: 10_000, ordinaryDividends: 5_000, taxableInterest: 5_000 });
check("J NII composition (qd+od+int)", J.niit, 760);

// pre-tax withdrawals & SS are NOT NII but raise MAGI
const K = computeTaxes({ ...base, otherOrdinaryIncome: 0, preTaxWithdrawals: 260_000, taxableInterest: 10_000 });
check("K pretax raises MAGI over threshold; NII only 10k", K.niit, 0.038 * 10_000);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll LTCG/NIIT checks passed");
