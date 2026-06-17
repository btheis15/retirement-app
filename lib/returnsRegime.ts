/**
 * Regime-Switching Lognormal (Hardy RSLN-2) Monte-Carlo engine — the
 * actuarial-reserving standard for long-horizon equity (used in CIA/AAA capital
 * work). Equity returns are drawn from a 2-state hidden Markov chain: a calm
 * BULL regime (high mean, moderate vol) most of the time, punctuated by a
 * turbulent BEAR regime (sharply negative mean) that PERSISTS — so bad years
 * cluster into multi-year drawdowns. That volatility clustering is what an
 * i.i.d. normal draw misses, and it's the dominant driver of sequence-of-returns
 * risk in retirement.
 *
 * Regime parameters are CALIBRATED OFFLINE by EM to S&P 500 annual returns
 * 1928–2024 (statsmodels MarkovRegression; see research/regimes.py) and stored in
 * lib/calibrated/regimes.json. To stay comparable to the forward-looking
 * parametric engine, the regime means are SHIFTED so the blended long-run mean
 * equals the same 2026 capital-market equity assumption — preserving the regime
 * SHAPE (the bull/bear spread + clustering) while matching the level. Bonds &
 * cash are drawn from their CMA mean/vol.
 *
 * ⚠️ Educational estimates only.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";
import { MonteCarloResult, wilsonInterval } from "./monteCarlo";
import regimeData from "./calibrated/regimes.json";

export const REGIME_META = {
  model: regimeData.model as string,
  source: regimeData.source as string,
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

  // Regime params, shifted so the blended equity mean == forward CMA equity mean.
  const bull = regimeData.regimes[0];
  const bear = regimeData.regimes[1];
  const shift = m.assets.equity.mean - regimeData.blendedMean;
  const mu = [bull.mean + shift, bear.mean + shift];
  const sd = [bull.vol, bear.vol];
  // Column-stochastic transition P[next][now]; P(next=bull | now=s) = P[0][s].
  const P = regimeData.transition as number[][];
  const pNextBull = [P[0][0], P[0][1]];
  const startBullProb = bull.stationaryWeight;

  // Standard normal via Box–Muller (cached pair) on the seeded RNG.
  let spare: number | null = null;
  const randn = (): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

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
    let state = rng() < startBullProb ? 0 : 1; // 0 bull, 1 bear
    const ensure = (i: number) => {
      while (rets.length <= i) {
        const equity = mu[state] + sd[state] * randn();
        const bond = m.assets.bonds.mean + m.assets.bonds.vol * randn();
        const cash = m.assets.cash.mean + m.assets.cash.vol * randn();
        rets.push(Math.max(-0.99, we * equity + wb * bond + wc * cash));
        // Advance the hidden state.
        state = rng() < pNextBull[state] ? 0 : 1;
      }
    };
    const returnFor = (i: number) => {
      ensure(i);
      return rets[i];
    };
    const proj = projectLifetime(household, { ...assumptions, returnFor, futureRateOverride });
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
    expectedReturn: m.expected,
    volatility: m.volatility,
  };
}
