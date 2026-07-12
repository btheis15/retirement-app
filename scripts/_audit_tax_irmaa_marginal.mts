/**
 * AUDIT PROBE 6+7 — IRMAA tier lookup / lookback / enrollees, and the
 * finite-difference effective marginal rate (SS torpedo).
 * Run: npx tsx scripts/_audit_tax_irmaa_marginal.mts
 *
 * IRMAA hand math (2026 MFJ tiers; surcharge is per person per month × 12 × enrollees):
 *  MAGI 218,000 exactly → standard tier ($0)          [CMS brackets are "≤ upper bound"]
 *  MAGI 218,001 → tier 1: $96/mo → household (2 enrollees) = 96×12×2 = 2,304
 *  MAGI 274,000 exactly → still tier 1
 *  MAGI 274,001 → tier 2: $240/mo → 5,760
 *  MAGI 800,000 → top tier: $578/mo → 13,872
 *  1 enrollee at tier 1 → 1,152 ; 0 enrollees → 0
 *  Single: MAGI 109,001 → tier 1 → 96×12×1 = 1,152
 *  Lookback: irmaaMagi=100,000 with current-year MAGI 300,000 → standard ($0)
 *
 * Torpedo hand math (MFJ, SS 40,000, other ordinary 40,000, num65Plus 0, IL state,
 * but pretax bump is IL-exempt so state Δ = 0):
 *  prov = 40,000 + 20,000 = 60,000 → taxable SS = 0.85×16,000 + 6,000 = 19,600
 *  AGI = 59,600, TI = 27,400 → 12% bracket
 *  +$1,000 pretax → taxable SS +850 → TI +1,850 → ΔFed ≈ 1,850×0.12 = 222 → 22.2%
 *  (statutory bracket says 12% — effective must be ≈ 22.2%)
 */
import { computeTaxes } from "../lib/tax/engine.ts";

let fails = 0;
function check(name: string, got: number, want: number, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(4)}, expected ${want.toFixed(4)}`);
}
const base = {
  otherOrdinaryIncome: 0, preTaxWithdrawals: 0, socialSecurity: 0,
  qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0, state: "none" as const,
};

function irmaa(magi: number, num65Plus: number, status: "mfj" | "single" = "mfj", f = 1) {
  return computeTaxes({ ...base, num65Plus, filingStatus: status, irmaaMagi: magi, inflationFactor: f }).irmaa;
}

check("MFJ MAGI exactly 218,000 → standard", irmaa(218_000, 2).householdAnnual, 0);
check("MFJ MAGI 218,001 → tier 1, 2 enrollees", irmaa(218_001, 2).householdAnnual, 2_304);
check("MFJ MAGI exactly 274,000 → still tier 1", irmaa(274_000, 2).householdAnnual, 2_304);
check("MFJ MAGI 274,001 → tier 2", irmaa(274_001, 2).householdAnnual, 5_760);
check("MFJ MAGI 800,000 → top tier", irmaa(800_000, 2).householdAnnual, 13_872);
check("1 enrollee tier 1", irmaa(218_001, 1).householdAnnual, 1_152);
check("0 enrollees → 0 even at huge MAGI", irmaa(800_000, 0).householdAnnual, 0);
check("Single MAGI 109,000 → standard", irmaa(109_000, 1, "single").householdAnnual, 0);
check("Single MAGI 109,001 → tier 1", irmaa(109_001, 1, "single").householdAnnual, 1_152);
check("Single MAGI 500,001 → top tier", irmaa(500_001, 1, "single").householdAnnual, 578 * 12);

// 2-year lookback plumbing: irmaaMagi overrides this year's MAGI
const look = computeTaxes({ ...base, otherOrdinaryIncome: 300_000, num65Plus: 2, irmaaMagi: 100_000 });
check("lookback: current MAGI 300k but irmaaMagi 100k → $0", look.irmaa.householdAnnual, 0);
const nolook = computeTaxes({ ...base, otherOrdinaryIncome: 300_000, num65Plus: 2 });
check("no irmaaMagi → falls back to this year's MAGI (300k → tier 2)", nolook.irmaa.householdAnnual, 5_760);

// IRMAA tier boundaries AND surcharge dollars are both inflation-indexed (CMS
// re-sets premiums yearly alongside the brackets): tier 1 at f=1.5 → 96×1.5/mo.
check("f=1.5: MAGI 300k < 218k×1.5=327k → standard", irmaa(300_000, 2, "mfj", 1.5).householdAnnual, 0);
check("f=1.5: MAGI 328k → tier 1, dollars ×1.5 (96×1.5×12×2)", irmaa(328_000, 2, "mfj", 1.5).householdAnnual, 3_456);
check("f=1.5: tier 1 per-person/mo = 96×1.5", irmaa(328_000, 2, "mfj", 1.5).perPerson, 144);

// ---- effective marginal rate / torpedo ----
const t = computeTaxes({ ...base, otherOrdinaryIncome: 40_000, socialSecurity: 40_000, num65Plus: 0, state: "IL" });
console.log(`\nINFO torpedo: statutory=${(t.marginalOrdinaryRate * 100).toFixed(1)}%  effective=${(t.effectiveMarginalRate * 100).toFixed(1)}%`);
check("torpedo zone: effective marginal ≈ 22.2% (1.85 × 12%)", t.effectiveMarginalRate, 0.222, 0.002);
if (t.effectiveMarginalRate <= t.marginalOrdinaryRate) { fails++; console.log("FAIL  effective marginal should exceed statutory in torpedo zone"); }
else console.log("PASS  effective marginal exceeds statutory bracket rate in torpedo zone");

// no infinite recursion / sane outside torpedo (SS fully capped, deep in 22%)
const q = computeTaxes({ ...base, otherOrdinaryIncome: 150_000, socialSecurity: 40_000, num65Plus: 0, state: "IL" });
check("past torpedo (SS at 85% cap): effective ≈ statutory 22%", q.effectiveMarginalRate, 0.22, 0.001);

// IL state component of a pretax bump is 0 (retirement income exempt) — fed-only check
const fedOnly = computeTaxes({ ...base, otherOrdinaryIncome: 150_000, socialSecurity: 40_000, num65Plus: 0, state: "none" });
check("IL adds nothing to pretax marginal (IL vs none identical)", q.effectiveMarginalRate, fedOnly.effectiveMarginalRate, 1e-9);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll IRMAA/marginal checks passed");
