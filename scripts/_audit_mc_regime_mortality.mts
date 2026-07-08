/**
 * Audit probe 2 — Regime-switching (RSLN-2) analytic vs simulated moments,
 * transition/stationary consistency, mortality (Gompertz vs SSA anchors,
 * monotonicity, joint survival), historical bootstrap data anchors + block wrap,
 * percentile interpolation + Wilson interval.
 * Run: npx tsx scripts/_audit_mc_regime_mortality.mts
 */
import regimeData from "../lib/calibrated/regimes.json";
import { randn } from "../lib/monteCarlo.ts";
import { CMA } from "../lib/returns.ts";
import { HISTORICAL_ANNUAL } from "../lib/returnsHistorical.ts";
import { paramsFor, survival, survivalToAge, jointSurvivalToAge, lifeExpectancy, survivalCurve, planningHorizonAge } from "../lib/mortality.ts";
import { wilsonInterval } from "../lib/monteCarlo.ts";

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 1. Regime engine ----------
{
  const bull = regimeData.regimes[0];
  const bear = regimeData.regimes[1];
  const P = regimeData.transition as number[][]; // column-stochastic P[next][now]
  console.log("== RSLN-2 calibration consistency ==");
  console.log(`columns sum: bull ${(P[0][0] + P[1][0]).toFixed(4)}, bear ${(P[0][1] + P[1][1]).toFixed(4)} (column-stochastic; each must = 1)`);
  // stationary from transition
  const pBearGivenBull = P[1][0], pBullGivenBear = P[0][1];
  const piBear = pBearGivenBull / (pBearGivenBull + pBullGivenBear);
  console.log(`stationary bear from P = ${piBear.toFixed(4)} vs json stationaryWeight ${bear.stationaryWeight}`);
  const blended = bull.stationaryWeight * bull.mean + bear.stationaryWeight * bear.mean;
  console.log(`blended mean from weights = ${blended.toFixed(4)} vs json blendedMean ${regimeData.blendedMean}`);
  const mixVarRaw = bull.stationaryWeight * (bull.vol ** 2 + (bull.mean - blended) ** 2) + bear.stationaryWeight * (bear.vol ** 2 + (bear.mean - blended) ** 2);
  console.log(`mixture vol from params = ${Math.sqrt(mixVarRaw).toFixed(4)} vs json mixtureVol ${regimeData.mixtureVol}`);
  console.log(`stay probs: json bull.stay ${bull.stay} == P[0][0] ${P[0][0]}; bear.stay ${bear.stay} == P[1][1] ${P[1][1]}`);
  console.log(`expected spell: bull 1/(1-stay)=${(1 / (1 - bull.stay)).toFixed(1)} (json ${bull.expectedSpellYears}); bear ${(1 / (1 - bear.stay)).toFixed(1)} (json ${bear.expectedSpellYears})`);

  // Replicate returnsRegime.ts retargeting math exactly, then simulate the chain.
  // FIXED engine: blended mean comes from weights×means, not the JSON's rounded
  // blendedMean (which left the retargeted mean ~2bp shy of the CMA).
  const wBull = bull.stationaryWeight, wBear = bear.stationaryWeight;
  const shift = CMA.equity.mean - (wBull * bull.mean + wBear * bear.mean);
  const muShift = [bull.mean + shift, bear.mean + shift];
  const overallMean = wBull * muShift[0] + wBear * muShift[1];
  const mixVar =
    wBull * (bull.vol * bull.vol + (muShift[0] - overallMean) ** 2) +
    wBear * (bear.vol * bear.vol + (muShift[1] - overallMean) ** 2);
  const k = CMA.equity.vol / Math.sqrt(mixVar);
  const mu = [overallMean + k * (muShift[0] - overallMean), overallMean + k * (muShift[1] - overallMean)];
  const sd = [k * bull.vol, k * bear.vol];
  // analytic retargeted mixture
  const aMean = wBull * mu[0] + wBear * mu[1];
  const aVar = wBull * (sd[0] ** 2 + (mu[0] - aMean) ** 2) + wBear * (sd[1] ** 2 + (mu[1] - aMean) ** 2);
  console.log(`\nretargeted: bull mu=${(mu[0] * 100).toFixed(2)}% sd=${(sd[0] * 100).toFixed(2)}%; bear mu=${(mu[1] * 100).toFixed(2)}% sd=${(sd[1] * 100).toFixed(2)}%`);
  console.log(`analytic stationary mixture: mean=${(aMean * 100).toFixed(3)}% (target ${(CMA.equity.mean * 100).toFixed(2)}%), vol=${(Math.sqrt(aVar) * 100).toFixed(3)}% (target ${(CMA.equity.vol * 100).toFixed(2)}%)`);

  // simulate 1M years of the chain exactly as returnsRegime.ts does
  const rng = makeRng(24680);
  const pNextBull = [P[0][0], P[0][1]];
  let state = rng() < wBull ? 0 : 1;
  const T = 1_000_000;
  let s = 0, s2 = 0, bearYears = 0, bearAfterBear = 0, bearCount = 0;
  let prevState = state;
  for (let t = 0; t < T; t++) {
    const r = mu[state] + sd[state] * randn(rng);
    s += r; s2 += r * r;
    if (state === 1) bearYears++;
    if (t > 0) {
      if (prevState === 1) { bearCount++; if (state === 1) bearAfterBear++; }
    }
    prevState = state;
    state = rng() < pNextBull[state] ? 0 : 1;
  }
  const m = s / T, v = s2 / T - m * m;
  console.log(`simulated 1M yrs: mean=${(m * 100).toFixed(3)}% vol=${(Math.sqrt(v) * 100).toFixed(3)}%; bear freq=${(bearYears / T).toFixed(4)} (target ${wBear}); P(bear|bear)=${(bearAfterBear / bearCount).toFixed(3)} (target ${P[1][1]})`);
}

// ---------- 2. Mortality ----------
{
  console.log("\n== Mortality (Gompertz vs SSA 2021 anchors) ==");
  const AGES = [65, 70, 75, 80, 85, 90, 95, 100, 105];
  const SSA: Record<string, number[]> = {
    male: [1.0, 0.901, 0.781, 0.629, 0.443, 0.249, 0.099, 0.025, 0.003],
    female: [1.0, 0.929, 0.836, 0.709, 0.541, 0.342, 0.162, 0.05, 0.008],
  };
  for (const sex of ["male", "female"] as const) {
    const p = paramsFor(sex);
    let worst = 0, worstAge = 0;
    for (let i = 0; i < AGES.length; i++) {
      const sModel = survivalToAge(65, AGES[i], p);
      const err = Math.abs(sModel - SSA[sex][i]);
      if (err > worst) { worst = err; worstAge = AGES[i]; }
    }
    const q65 = 1 - survival(65, 1, p);
    const q75 = 1 - survival(75, 1, p);
    const q85 = 1 - survival(85, 1, p);
    console.log(`${sex}: q65=${(q65 * 100).toFixed(2)}% q75=${(q75 * 100).toFixed(2)}% q85=${(q85 * 100).toFixed(2)}%  worst survival-anchor abs err=${worst.toFixed(4)} @${worstAge}`);
    console.log(`  LE@65=${lifeExpectancy(65, p).toFixed(1)} (json ${sex === "male" ? 83.2 : 85.4});  P(reach90)=${survivalToAge(65, 90, p).toFixed(3)}  P(reach95)=${survivalToAge(65, 95, p).toFixed(3)}`);
    // monotonicity of survival in t and of qx increasing in age
    let mono = true, qmono = true;
    let prevS = 1, prevQ = 0;
    for (let t = 1; t <= 55; t++) {
      const st = survival(65, t, p);
      if (st > prevS + 1e-12) mono = false;
      prevS = st;
      const q = 1 - survival(64 + t, 1, p);
      if (q < prevQ - 1e-12) qmono = false;
      prevQ = q;
    }
    console.log(`  survival monotone decreasing: ${mono};  q_x monotone increasing: ${qmono}`);
  }
  // joint survival identity
  const pm = paramsFor("male"), pf = paramsFor("female");
  const t = 25;
  const sM = survival(67, t, pm), sF = survival(65, t, pf);
  const joint = jointSurvivalToAge({ age: 67, p: pm }, { age: 65, p: pf }, t);
  console.log(`joint last-survivor identity: 1-(1-sM)(1-sF)=${(1 - (1 - sM) * (1 - sF)).toFixed(6)} == jointSurvivalToAge ${joint.toFixed(6)}`);
  const curve = survivalCurve({ currentAge: 65, sex: "male" }, { currentAge: 63, sex: "female" });
  const eitherMono = curve.every((pt, i) => i === 0 || pt.either <= curve[i - 1].either + 1e-12);
  console.log(`survivalCurve 'either' monotone decreasing: ${eitherMono}; horizon(10% tail)=${planningHorizonAge({ currentAge: 65, sex: "male" }, { currentAge: 63, sex: "female" })}`);
}

// ---------- 3. Historical data anchors + block bootstrap wrap ----------
{
  console.log("\n== Historical series anchors ==");
  const byYear = new Map(HISTORICAL_ANNUAL.map((d) => [d.year, d]));
  const checks: [number, keyof (typeof HISTORICAL_ANNUAL)[0], number][] = [
    [1931, "stock", -0.4384], [1933, "stock", 0.4998], [1954, "stock", 0.5256],
    [1974, "stock", -0.2590], [2008, "stock", -0.3655], [2022, "stock", -0.1804],
    [2022, "bond", -0.1783], [1982, "bond", 0.3282], [1980, "infl", 0.1252],
    [1946, "infl", 0.1813], [1932, "infl", -0.1027], [1981, "bill", 0.1404],
  ];
  for (const [y, k, expVal] of checks) {
    const got = (byYear.get(y) as any)[k];
    const ok = Math.abs(got - expVal) < 0.002;
    console.log(`  ${y} ${String(k)}: ${got}  (expected ~${expVal})  ${ok ? "OK" : "MISMATCH"}`);
  }
  const n = HISTORICAL_ANNUAL.length;
  console.log(`rows=${n} (1928..2024 => 97): ${n === 97}; years contiguous: ${HISTORICAL_ANNUAL.every((d, i) => d.year === 1928 + i)}`);
  const meanStock = HISTORICAL_ANNUAL.reduce((s, d) => s + d.stock, 0) / n;
  console.log(`historical stock arithmetic mean=${(meanStock * 100).toFixed(2)}% (README says 11.79%); detrend shift to CMA=${((CMA.equity.mean - meanStock) * 100).toFixed(2)}pp`);

  // Replicate the bootstrap block logic (returnsHistorical.ts ensure()) and check
  // indices stay in range, blocks are contiguous (mod wrap), and detrended means land on CMA.
  const rng = makeRng(12345);
  const blockYears = 8;
  const N2 = n;
  const horizon = 40;
  let minIdx = Infinity, maxIdx = -Infinity;
  let contiguous = true;
  const stockAdj = CMA.equity.mean - meanStock;
  let sum = 0, count = 0;
  for (let r = 0; r < 20000; r++) {
    const idxs: number[] = [];
    while (idxs.length <= horizon) {
      const start = Math.floor(rng() * N2);
      for (let k = 0; k < blockYears && idxs.length <= horizon + blockYears; k++) {
        const idx = (start + k) % N2;
        idxs.push(idx);
        minIdx = Math.min(minIdx, idx); maxIdx = Math.max(maxIdx, idx);
        sum += HISTORICAL_ANNUAL[idx].stock + stockAdj; count++;
      }
    }
    for (let i = 1; i < Math.min(idxs.length, blockYears); i++) {
      if (idxs[i] !== (idxs[i - 1] + 1) % N2) contiguous = false;
    }
  }
  console.log(`bootstrap index range [${minIdx}, ${maxIdx}] within [0, ${N2 - 1}]: ${minIdx >= 0 && maxIdx <= N2 - 1}; first-block contiguity (circular): ${contiguous}`);
  console.log(`detrended sampled stock mean=${((sum / count) * 100).toFixed(3)}% (target ${(CMA.equity.mean * 100).toFixed(2)}%)`);
}

// ---------- 4. Percentile + Wilson ----------
{
  console.log("\n== Percentile & Wilson ==");
  // pct on a known array
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const pct = (sorted: number[], p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  console.log(`p50 of 1..10 = ${pct(arr, 0.5)} (exp 5.5); p10 = ${pct(arr, 0.1)} (exp 1.9); p90 = ${pct(arr, 0.9)} (exp 9.1)`);
  const wi = wilsonInterval(900, 1000);
  console.log(`Wilson 900/1000: p=${wi.p} lo=${wi.lo.toFixed(4)} hi=${wi.hi.toFixed(4)} (published Wilson 95%: 0.8797-0.9174) se=${wi.se.toFixed(4)} (exp ${Math.sqrt(0.9 * 0.1 / 1000).toFixed(4)})`);
  const w0 = wilsonInterval(0, 1000), w1 = wilsonInterval(1000, 1000);
  console.log(`edges: 0/1000 -> [${w0.lo.toFixed(4)}, ${w0.hi.toFixed(4)}]; 1000/1000 -> [${w1.lo.toFixed(4)}, ${w1.hi.toFixed(4)}]`);
}
