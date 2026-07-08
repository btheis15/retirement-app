/**
 * Regime-Switching Monte-Carlo engine (Hardy-style RSN-2; fit and simulated on
 * SIMPLE annual returns rather than Hardy's log-returns, hence "N" not "LN") — the
 * actuarial-reserving standard for long-horizon equity (used in CIA/AAA capital
 * work). Equity returns are drawn from a 2-state hidden Markov chain: a calm
 * BULL regime most of the time, punctuated by a sharply NEGATIVE-mean BEAR regime.
 * A down year is markedly more likely to be followed by another down year than
 * chance would imply (P(bear|bear) ≈ 0.36 vs an 0.12 unconditional rate), so bad
 * years CLUSTER — and that mean-shift clustering, plus the fat left tail it
 * creates, is what an i.i.d. draw misses. (Note: the fitted within-regime vols
 * are similar — bull ~15.9%, bear ~13.3% — so the bear's danger is its negative
 * mean and persistence, NOT higher single-year volatility.)
 *
 * Regime parameters are CALIBRATED OFFLINE by EM to S&P 500 annual returns
 * 1928–2024 (statsmodels MarkovRegression; see research/regimes.py) and stored in
 * lib/calibrated/regimes.json. To make this a clean apples-to-apples cross-check
 * of the MAIN engine — isolating regime SHAPE, not a different risk level — the
 * equity process is retargeted to the SAME forward capital-market assumptions:
 * the regime means are shifted so the blended long-run mean equals the CMA equity
 * mean, AND the regime dispersion is scaled so the long-run (stationary mixture)
 * equity volatility equals the CMA equity vol. Bonds, cash and inflation use the
 * SAME correlation structure (Cholesky) and the same AR(1) inflation as the main
 * engine — though as plain Gaussians on simple returns, without the main engine's
 * lognormal/Student-t dressing (immaterial at bond/cash vols; portfolio clamped
 * at −99%) — so the difference from the headline Monte-Carlo is that equity
 * switches regimes (clustering) instead of being i.i.d.
 *
 * ⚠️ Educational estimates only. The bear regime is identified from only ~11 of
 * 97 historical years, so its parameters carry wide error bars.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";
import { MonteCarloResult, wilsonInterval, cholesky, randn } from "./monteCarlo";
import regimeData from "./calibrated/regimes.json";

export const REGIME_META = {
  model: regimeData.model as string,
  source: regimeData.source as string,
  blendedMean: regimeData.blendedMean as number,
  bull: regimeData.regimes[0],
  bear: regimeData.regimes[1],
};

function pctl(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** mulberry32 — same seeded RNG family as the other engines. */
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

export interface RegimeOptions {
  model: ReturnModel;
  runs?: number;
  seed?: number;
}

export function runRegimeSwitching(
  household: Household,
  assumptions: ProjectionAssumptions,
  opts: RegimeOptions,
): MonteCarloResult {
  const runs = opts.runs ?? 1000;
  const rng = makeRng(opts.seed ?? 24680);
  const m = opts.model;
  const we = m.assets.equity.weight;
  const wb = m.assets.bonds.weight;
  const wc = m.assets.cash.weight;

  const bull = regimeData.regimes[0];
  const bear = regimeData.regimes[1];
  const wBull = bull.stationaryWeight;
  const wBear = bear.stationaryWeight;
  // 1) Shift so the stationary blended equity mean == forward CMA equity mean.
  //    Compute the blend from the stored per-regime means/weights rather than
  //    trusting the JSON's (rounded) `blendedMean`, which was ~2bp off and left
  //    the retargeted mean shy of the CMA.
  const blendedMean = wBull * bull.mean + wBear * bear.mean;
  const shift = m.assets.equity.mean - blendedMean;
  const muShift = [bull.mean + shift, bear.mean + shift];
  const overallMean = wBull * muShift[0] + wBear * muShift[1]; // == CMA equity mean
  // 2) Scale dispersion so the stationary MIXTURE vol == forward CMA equity vol.
  //    Mixture var = E[within-regime var] + Var(regime means).
  const mixVar =
    wBull * (bull.vol * bull.vol + (muShift[0] - overallMean) ** 2) +
    wBear * (bear.vol * bear.vol + (muShift[1] - overallMean) ** 2);
  const k = Math.sqrt(mixVar) > 0 ? m.assets.equity.vol / Math.sqrt(mixVar) : 1;
  // Retargeted per-regime mean/sd actually simulated (mean & vol now match the CMA).
  const mu = [overallMean + k * (muShift[0] - overallMean), overallMean + k * (muShift[1] - overallMean)];
  const sd = [k * bull.vol, k * bear.vol];

  // Column-stochastic transition P[next][now]; P(next=bull | now=s) = P[0][s].
  const P = regimeData.transition as number[][];
  const pNextBull = [P[0][0], P[0][1]];

  // 4×4 correlation over [equity, bonds, cash, inflation] — identical to the main
  // engine, so the regime engine keeps the advertised cross-asset co-movement.
  const INFL_CORR = { eq: -0.01, bonds: -0.24, cash: -0.03 };
  const c3 = m.corr;
  const L = cholesky([
    [c3[0][0], c3[0][1], c3[0][2], INFL_CORR.eq],
    [c3[1][0], c3[1][1], c3[1][2], INFL_CORR.bonds],
    [c3[2][0], c3[2][1], c3[2][2], INFL_CORR.cash],
    [INFL_CORR.eq, INFL_CORR.bonds, INFL_CORR.cash, 1],
  ]);

  // Stochastic inflation: the same sticky AR(1) the main engine uses.
  const pibar = assumptions.inflationRate;
  const PHI = 0.6;
  const SIGMA_INFL = 0.0177;
  const sigmaEps = SIGMA_INFL * Math.sqrt(1 - PHI * PHI);

  const det = projectLifetime(household, assumptions);
  const futureRateOverride = det.futureRate;

  const endings: number[] = [];
  const endingsReal: number[] = [];
  const shortfallAges: number[] = [];
  const cuts: number[] = [];
  let successes = 0;
  const cols: number[][] = [];
  const colsReal: number[][] = [];

  for (let r = 0; r < runs; r++) {
    const rets: number[] = [];
    const infls: number[] = [];
    // Seed the AR(1) from its STATIONARY distribution (sd = sigma/sqrt(1-phi^2)),
    // not from the mean — starting at the mean understates inflation risk exactly
    // in the sequence-risk-critical first years of retirement.
    let prevInfl = pibar + (sigmaEps / Math.sqrt(1 - PHI * PHI)) * randn(rng);
    let state = rng() < wBull ? 0 : 1; // 0 bull, 1 bear (from the stationary mix)
    const ensure = (i: number) => {
      while (rets.length <= i) {
        // Correlated standard-normal vector for [equity, bonds, cash, inflation].
        const nv = [randn(rng), randn(rng), randn(rng), randn(rng)];
        const z = [0, 0, 0, 0];
        for (let a = 0; a < 4; a++) {
          let s = 0;
          for (let b = 0; b <= a; b++) s += L[a][b] * nv[b];
          z[a] = s;
        }
        const equity = mu[state] + sd[state] * z[0];
        const bond = m.assets.bonds.mean + m.assets.bonds.vol * z[1];
        const cash = m.assets.cash.mean + m.assets.cash.vol * z[2];
        rets.push(Math.max(-0.99, we * equity + wb * bond + wc * cash));
        const infl = Math.max(-0.02, Math.min(0.12, pibar + PHI * (prevInfl - pibar) + sigmaEps * z[3]));
        prevInfl = infl;
        infls.push(infl);
        // Advance the hidden regime AFTER drawing this year's return.
        state = rng() < pNextBull[state] ? 0 : 1;
      }
    };
    const returnFor = (i: number) => {
      ensure(i);
      return rets[i];
    };
    const inflationFor = (i: number) => {
      ensure(i);
      return infls[i];
    };
    const proj = projectLifetime(household, { ...assumptions, returnFor, inflationFor, futureRateOverride });
    endings.push(proj.endingEstate);
    endingsReal.push(proj.endingEstateReal);
    cuts.push(Math.max(0, 1 - proj.minRealSpendRatio));
    if (proj.depleted) {
      const short = proj.rows.find((row) => row.shortfall);
      shortfallAges.push(short ? short.selfAge : det.rows[det.rows.length - 1]?.selfAge ?? 0);
    } else {
      successes++;
    }
    proj.rows.forEach((row, i) => {
      (cols[i] ??= []).push(row.endTotal);
      (colsReal[i] ??= []).push(row.inflationFactor > 0 ? row.endTotal / row.inflationFactor : row.endTotal);
    });
  }

  endings.sort((a, b) => a - b);
  endingsReal.sort((a, b) => a - b);
  shortfallAges.sort((a, b) => a - b);
  cuts.sort((a, b) => a - b);
  const worstCount = Math.max(1, Math.floor(runs * 0.1));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const ci = wilsonInterval(successes, runs);
  const pctlBand = (matrix: number[][]) =>
    matrix.map((col, i) => {
      col.sort((a, b) => a - b);
      return {
        year: det.rows[i]?.year ?? 0,
        selfAge: det.rows[i]?.selfAge ?? 0,
        p10: pctl(col, 0.1),
        p25: pctl(col, 0.25),
        p50: pctl(col, 0.5),
        p75: pctl(col, 0.75),
        p90: pctl(col, 0.9),
      };
    });
  const wealthPctiles = (xs: number[]) => ({
    p10: pctl(xs, 0.1),
    p25: pctl(xs, 0.25),
    p50: pctl(xs, 0.5),
    p75: pctl(xs, 0.75),
    p90: pctl(xs, 0.9),
  });

  return {
    runs,
    successPct: ci.p,
    successCI: [ci.lo, ci.hi],
    successSE: ci.se,
    endingWealth: wealthPctiles(endings),
    endingWealthReal: wealthPctiles(endingsReal),
    cvarEndingWealth: avg(endings.slice(0, worstCount)),
    cvarEndingWealthReal: avg(endingsReal.slice(0, worstCount)),
    medianShortfallAge: shortfallAges.length ? pctl(shortfallAges, 0.5) : 0,
    spendCut: { p50: pctl(cuts, 0.5), p90: pctl(cuts, 0.9) },
    band: pctlBand(cols),
    bandReal: pctlBand(colsReal),
    // Mean & vol now MATCH the main engine (we retargeted both), so reporting the
    // parametric blended figures is honest — the difference is shape only.
    expectedReturn: m.expected,
    volatility: m.volatility,
    regimeInfo: { bullMean: mu[0], bearMean: mu[1], bullWeight: wBull },
  };
}
