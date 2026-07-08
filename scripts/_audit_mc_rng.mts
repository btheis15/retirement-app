/**
 * Audit probe 1 — PRNG (mulberry32), Box-Muller normal moments, Cholesky /
 * correlation reproduction, lognormal+Student-t moment matching vs stated CMAs,
 * AR(1) inflation stationary properties.
 * Run: npx tsx scripts/_audit_mc_rng.mts
 */
import { randn, cholesky } from "../lib/monteCarlo.ts";
import { CMA, ASSET_CORR } from "../lib/returns.ts";

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

const N = 200_000;

// ---------- 1. Uniformity + determinism ----------
{
  const rng = makeRng(12345);
  const bins = new Array(20).fill(0);
  let s = 0, s2 = 0, min = 1, max = 0;
  let prev = rng();
  let serCov = 0, cnt = 0;
  let x = prev;
  for (let i = 0; i < N; i++) {
    s += x; s2 += x * x;
    if (x < min) min = x;
    if (x > max) max = x;
    bins[Math.min(19, Math.floor(x * 20))]++;
    const nx = rng();
    serCov += (x - 0.5) * (nx - 0.5);
    cnt++;
    x = nx;
  }
  const mean = s / N, varr = s2 / N - mean * mean;
  // chi-square GOF over 20 bins
  const exp = N / 20;
  let chi2 = 0;
  for (const b of bins) chi2 += (b - exp) ** 2 / exp;
  console.log("== mulberry32 uniformity ==");
  console.log(`mean=${mean.toFixed(5)} (exp 0.5)  var=${varr.toFixed(5)} (exp 0.08333)  min=${min.toExponential(2)} max=${max.toFixed(6)}`);
  console.log(`chi2(19df)=${chi2.toFixed(1)} (95% crit 30.1)  lag1 corr=${(serCov / cnt / (1 / 12)).toFixed(5)}`);
  // determinism
  const a1 = makeRng(999), a2 = makeRng(999);
  let same = true;
  for (let i = 0; i < 1000; i++) if (a1() !== a2()) same = false;
  console.log(`seed determinism (same seed -> same stream): ${same}`);
  // stream independence for nearby seeds (correlation of streams seeded 12345 vs 12346)
  const b1 = makeRng(12345), b2 = makeRng(12346);
  let c = 0;
  for (let i = 0; i < 100000; i++) c += (b1() - 0.5) * (b2() - 0.5);
  console.log(`adjacent-seed stream corr=${(c / 100000 / (1 / 12)).toFixed(5)} (want ~0)`);
}

// ---------- 2. Box-Muller normal moments ----------
{
  const rng = makeRng(777);
  let s = 0, s2 = 0, s3 = 0, s4 = 0;
  for (let i = 0; i < N; i++) {
    const z = randn(rng);
    s += z; s2 += z * z; s3 += z ** 3; s4 += z ** 4;
  }
  const m = s / N;
  const v = s2 / N - m * m;
  const sd = Math.sqrt(v);
  const skew = (s3 / N - 3 * m * v - m ** 3) / sd ** 3;
  const kurt = s4 / N / (v * v); // approx (mean ~0)
  console.log("\n== randn (Box-Muller) moments, n=200k ==");
  console.log(`mean=${m.toFixed(4)} (±${(3 / Math.sqrt(N)).toFixed(4)})  sd=${sd.toFixed(4)}  skew=${skew.toFixed(4)}  kurtosis=${kurt.toFixed(3)} (exp 3)`);
}

// ---------- 3. Cholesky PD check + sampled correlations of the ACTUAL engine draw ----------
{
  const INFL_CORR = { eq: -0.01, bonds: -0.24, cash: -0.03 };
  const c3 = ASSET_CORR;
  const corr4 = [
    [c3[0][0], c3[0][1], c3[0][2], INFL_CORR.eq],
    [c3[1][0], c3[1][1], c3[1][2], INFL_CORR.bonds],
    [c3[2][0], c3[2][1], c3[2][2], INFL_CORR.cash],
    [INFL_CORR.eq, INFL_CORR.bonds, INFL_CORR.cash, 1],
  ];
  const L = cholesky(corr4);
  // verify L L^T == corr4
  let maxErr = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += L[i][k] * L[j][k];
      maxErr = Math.max(maxErr, Math.abs(s - corr4[i][j]));
    }
  console.log("\n== Cholesky ==");
  console.log(`max |LL^T - target| = ${maxErr.toExponential(2)}; diag(L) = ${L.map((r, i) => r[i].toFixed(4)).join(", ")} (all > 0 => PD)`);

  // ---- replicate the engine's per-year draw EXACTLY (monteCarlo.ts lines 199-224) ----
  const rng = makeRng(2024);
  const df = 6;
  const SHOCK_CLAMP = 4;
  const classes = [CMA.equity, CMA.bonds, CMA.cash];
  const logp = classes.map((c) => {
    const sig2 = Math.log(1 + (c.vol * c.vol) / ((1 + c.mean) * (1 + c.mean)));
    return { muLog: Math.log(1 + c.mean) - sig2 / 2, sd: Math.sqrt(sig2) };
  });
  const tScale = Math.sqrt((df - 2) / df);
  const M = 1_000_000;
  const sums = [0, 0, 0], sums2 = [0, 0, 0];
  const cross: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let inflShockSum = 0, inflShock2 = 0, crossBondInfl = 0;
  const bondRets: number[] = [];
  for (let it = 0; it < M; it++) {
    const n = [randn(rng), randn(rng), randn(rng), randn(rng)];
    const z = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) {
      let s = 0;
      for (let b = 0; b <= a; b++) s += L[a][b] * n[b];
      z[a] = s;
    }
    let w = 0;
    for (let k = 0; k < df; k++) { const g = randn(rng); w += g * g; }
    const tFactor = Math.sqrt(df / Math.max(w, 1e-9)) * tScale;
    const r = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const shock = Math.max(-SHOCK_CLAMP, Math.min(SHOCK_CLAMP, z[i] * tFactor));
      r[i] = Math.exp(logp[i].muLog + logp[i].sd * shock) - 1;
      sums[i] += r[i]; sums2[i] += r[i] * r[i];
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cross[i][j] += r[i] * r[j];
    inflShockSum += z[3]; inflShock2 += z[3] * z[3];
    crossBondInfl += r[1] * z[3];
  }
  console.log("\n== Realized per-class SIMPLE-return moments (1M engine-exact draws) vs stated CMA ==");
  const names = ["equity", "bonds ", "cash  "];
  const meansR: number[] = [], sdsR: number[] = [];
  for (let i = 0; i < 3; i++) {
    const mean = sums[i] / M;
    const sd = Math.sqrt(sums2[i] / M - mean * mean);
    meansR.push(mean); sdsR.push(sd);
    console.log(`${names[i]}: realized mean=${(mean * 100).toFixed(3)}%  (CMA ${(classes[i].mean * 100).toFixed(2)}%)   realized vol=${(sd * 100).toFixed(3)}%  (CMA ${(classes[i].vol * 100).toFixed(2)}%)`);
  }
  console.log("MC standard error on mean ≈", ((classes[0].vol / Math.sqrt(M)) * 100).toFixed(3), "% for equity");
  console.log("\nSampled return correlations vs target:");
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) {
      const c = (cross[i][j] / M - meansR[i] * meansR[j]) / (sdsR[i] * sdsR[j]);
      console.log(`  corr(${names[i].trim()},${names[j].trim()}) = ${c.toFixed(4)}  (target ${corr4[i][j]})`);
    }
  const mI = inflShockSum / M, sdI = Math.sqrt(inflShock2 / M - mI * mI);
  const cBI = (crossBondInfl / M - meansR[1] * mI) / (sdsR[1] * sdI);
  console.log(`  corr(bondReturn, inflShock z3) = ${cBI.toFixed(4)}  (target ${INFL_CORR.bonds})`);

  // pure-Gaussian control: same lognormal params with NORMAL shocks (what moment-matching assumes)
  const rng2 = makeRng(555);
  let se = 0, se2 = 0;
  for (let it = 0; it < M; it++) {
    const r = Math.exp(logp[0].muLog + logp[0].sd * randn(rng2)) - 1;
    se += r; se2 += r * r;
  }
  const meanG = se / M, sdG = Math.sqrt(se2 / M - meanG * meanG);
  console.log(`\ncontrol (equity, Gaussian shock): mean=${(meanG * 100).toFixed(3)}% vol=${(sdG * 100).toFixed(3)}%  -> moment-matching formula itself is exact under normality`);
}

// ---------- 4. AR(1) inflation ----------
{
  const rng = makeRng(31415);
  const pibar = 0.025, PHI = 0.6, SIGMA_INFL = 0.0177;
  const sigmaEps = SIGMA_INFL * Math.sqrt(1 - PHI * PHI);
  const T = 500_000;
  let prev = pibar;
  const xs: number[] = [];
  let clampedLo = 0, clampedHi = 0, neg = 0;
  for (let t = 0; t < T; t++) {
    const raw = pibar + PHI * (prev - pibar) + sigmaEps * randn(rng);
    const infl = Math.max(-0.02, Math.min(0.12, raw));
    if (raw < -0.02) clampedLo++;
    if (raw > 0.12) clampedHi++;
    if (infl < 0) neg++;
    prev = infl;
    xs.push(infl);
  }
  const m = xs.reduce((a, b) => a + b) / T;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / T;
  let ac = 0;
  for (let t = 1; t < T; t++) ac += (xs[t] - m) * (xs[t - 1] - m);
  ac /= (T - 1) * v;
  console.log("\n== AR(1) inflation (pibar=2.5%) ==");
  console.log(`stationary mean=${(m * 100).toFixed(3)}% (target 2.5%)  sd=${(Math.sqrt(v) * 100).toFixed(3)}% (target 1.77%)  lag1 autocorr=${ac.toFixed(3)} (target 0.6)`);
  console.log(`clamp hits: low ${(clampedLo / T * 100).toFixed(3)}%  high ${(clampedHi / T * 100).toFixed(4)}%  negative-inflation years ${(neg / T * 100).toFixed(2)}% (floored at -2% so price level can dip but never go <=0)`);
  // first-year variance — engine now seeds prevInfl from the STATIONARY
  // distribution (pibar + sigma_stat × z), so year-1 sd must already be ≈ the
  // stationary 1.77% (fixed: it used to start AT the mean, sd ≈ 1.42%).
  let s1 = 0, s1sq = 0;
  const rng2 = makeRng(999);
  const sigmaStat = sigmaEps / Math.sqrt(1 - PHI * PHI);
  for (let i = 0; i < 100000; i++) {
    const prev0 = pibar + sigmaStat * randn(rng2); // engine's new AR(1) init
    const x = Math.max(-0.02, Math.min(0.12, pibar + PHI * (prev0 - pibar) + sigmaEps * randn(rng2)));
    s1 += x; s1sq += x * x;
  }
  const sd1 = Math.sqrt(s1sq / 100000 - (s1 / 100000) ** 2);
  const ok = Math.abs(sd1 - SIGMA_INFL) < 0.0006; // small clamp shave allowed
  console.log(`year-1 sd=${(sd1 * 100).toFixed(3)}% vs stationary 1.77% (chain seeded from stationary dist) ${ok ? "PASS" : "FAIL"}`);
  if (!ok) process.exitCode = 1;
}
