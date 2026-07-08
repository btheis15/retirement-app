/**
 * Audit probe 4 — historical bootstrap inflation clamp retargeting + realized
 * bootstrap portfolio moments vs targets; regime retarget blend consistency.
 *
 * UPDATED for the fixed engine: returnsHistorical.ts now runs a fixed-point
 * adjustment so the POST-clamp inflation mean hits assumptions.inflationRate
 * (the naive detrend left a +10–22bp/yr pessimism bias from the asymmetric
 * [-2%, +12%] clamp), and returnsRegime.ts computes the blended equity mean
 * from weights×means instead of trusting the JSON's rounded blendedMean.
 * This probe replicates BOTH the old and new math and asserts the new one.
 *
 * Run: npx tsx scripts/_audit_mc_bootstrap_infl.mts
 */
import { HISTORICAL_ANNUAL } from "../lib/returnsHistorical.ts";
import { CMA } from "../lib/returns.ts";
import regimeData from "../lib/calibrated/regimes.json";

const data = HISTORICAL_ANNUAL;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const clampInfl = (x: number) => Math.max(-0.02, Math.min(0.12, x));
let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };

// ---- inflation clamp retarget, exactly as the FIXED returnsHistorical.ts ----
for (const target of [0.02, 0.025, 0.03, 0.035]) {
  // old naive detrend (kept as context — this is the bias the fix removes)
  const naive = target - mean(data.map((d) => d.infl));
  const naiveBias = mean(data.map((d) => clampInfl(d.infl + naive))) - target;
  // fixed-point retarget (engine replica: 4 passes)
  let adjInfl = naive;
  for (let pass = 0; pass < 4; pass++) {
    const clampedMean = mean(data.map((d) => clampInfl(d.infl + adjInfl)));
    adjInfl += target - clampedMean;
  }
  const post = mean(data.map((d) => clampInfl(d.infl + adjInfl)));
  const bias = post - target;
  console.log(
    `target infl ${(target * 100).toFixed(1)}%: post-clamp sampled mean = ${(post * 100).toFixed(4)}%  (residual ${(bias * 10000).toFixed(2)} bp/yr; naive detrend would have been +${(naiveBias * 10000).toFixed(0)} bp/yr)`,
  );
  chk(Math.abs(bias) <= 0.0003, `post-clamp mean misses ${(target * 100).toFixed(1)}% target by ${(bias * 10000).toFixed(1)} bp (want ≤3bp)`);
}
{
  const target = 0.025;
  let adjInfl = target - mean(data.map((d) => d.infl));
  for (let pass = 0; pass < 4; pass++) adjInfl += target - mean(data.map((d) => clampInfl(d.infl + adjInfl)));
  const bias = mean(data.map((d) => clampInfl(d.infl + adjInfl))) - target;
  console.log(`30-yr price-level drift at 2.5% target: ${((Math.pow(1 + target + bias, 30) / Math.pow(1 + target, 30) - 1) * 100).toFixed(2)}% (was ~5.5% pre-fix)`);
  // which years still get clamped after the retarget shift
  console.log("clamped years (target 2.5%, retargeted shift):");
  data.forEach((d) => {
    const r = d.infl + adjInfl;
    if (r < -0.02 || r > 0.12) console.log(`  ${d.year}: raw ${(r * 100).toFixed(2)}% -> ${(clampInfl(r) * 100).toFixed(2)}%`);
  });
}

// ---- realized bootstrap portfolio mean/vol (weights 70/25/5) vs targets ----
const we = 0.7, wb = 0.25, wc = 0.05;
const adjStock = CMA.equity.mean - mean(data.map((d) => d.stock));
const adjBond = CMA.bonds.mean - mean(data.map((d) => d.bond));
const adjBill = CMA.cash.mean - mean(data.map((d) => d.bill));
const ports = data.map((d) => Math.max(-0.99, we * (d.stock + adjStock) + wb * (d.bond + adjBond) + wc * (d.bill + adjBill)));
const pm = mean(ports);
const pv = Math.sqrt(mean(ports.map((x) => (x - pm) ** 2)));
const targetMean = we * CMA.equity.mean + wb * CMA.bonds.mean + wc * CMA.cash.mean;
console.log(`\nbootstrap portfolio (70/25/5): mean=${(pm * 100).toFixed(3)}% (target ${(targetMean * 100).toFixed(3)}%)  vol=${(pv * 100).toFixed(2)}% (historical shape, intentionally NOT rescaled)`);
console.log(`bond detrend shift=${(adjBond * 100).toFixed(2)}pp  bill shift=${(adjBill * 100).toFixed(2)}pp  stock shift=${(adjStock * 100).toFixed(2)}pp`);
chk(Math.abs(pm - targetMean) < 1e-9, "bootstrap portfolio mean must equal blended CMA target exactly");

// ---- regime retarget: blend computed from weights×means (fixed), not the JSON ----
const bull = regimeData.regimes[0], bear = regimeData.regimes[1];
const exactBlend = bull.stationaryWeight * bull.mean + bear.stationaryWeight * bear.mean;
const shift = CMA.equity.mean - exactBlend; // engine replica (fixed)
const overallMean = bull.stationaryWeight * (bull.mean + shift) + bear.stationaryWeight * (bear.mean + shift);
const oldShift = CMA.equity.mean - regimeData.blendedMean; // pre-fix, from rounded JSON
const oldOverall = bull.stationaryWeight * (bull.mean + oldShift) + bear.stationaryWeight * (bear.mean + oldShift);
console.log(
  `\nregime retarget: weights×means=${exactBlend.toFixed(5)} (json blendedMean=${regimeData.blendedMean} is rounded); stationary equity mean after shift = ${(overallMean * 100).toFixed(4)}% vs CMA target ${(CMA.equity.mean * 100).toFixed(2)}% (gap ${((overallMean - CMA.equity.mean) * 10000).toFixed(2)} bp; pre-fix gap was ${((oldOverall - CMA.equity.mean) * 10000).toFixed(1)} bp)`,
);
chk(Math.abs(overallMean - CMA.equity.mean) < 1e-12, "retargeted stationary equity mean must equal the CMA mean exactly");

console.log(bad === 0 ? "\nBOOTSTRAP/REGIME RETARGET checks: ALL PASS" : `\nBOOTSTRAP/REGIME RETARGET checks: ${bad} FAILURES`);
if (bad) process.exitCode = 1;
