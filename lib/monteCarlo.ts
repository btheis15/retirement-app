/**
 * Monte-Carlo "probability of success" — the standard retirement confidence
 * metric, done the way high-end tools do it. Reruns the lifetime projection many
 * times with RANDOM annual returns and reports how often the plan funds full
 * spending to the end, with honest confidence bands and failure depth.
 *
 * High-end methodology:
 *  - MULTI-ASSET: equity / bonds / cash are drawn JOINTLY each year from a
 *    correlation matrix (Cholesky), not from one blended scalar — so a year where
 *    stocks AND bonds fall together (the post-2022 / near-retiree threat) can
 *    actually happen. Forward-looking 2026 capital-market assumptions.
 *  - FAT TAILS: shocks are a standardized multivariate Student-t (df≈6), so
 *    crashes and booms occur far more often than a normal would allow, and tail
 *    events hit all asset classes together (systemic).
 *  - SEQUENCE RISK emerges naturally: each year withdraws before it grows.
 *  - HONEST STATISTICS: 1,000 runs by default with the Wilson 95% confidence
 *    interval on the success rate — so "90% (88–92%)" instead of false precision.
 *  - FAILURE DEPTH: not just pass/fail — when plans fall short, at what age, and
 *    the worst-10% (CVaR) ending wealth.
 *
 * ⚠️ Educational estimates only. Independent annual draws capture fat tails and
 * sequence risk, but not serial correlation, regime shifts, or true crashes.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";

export interface MonteCarloResult {
  runs: number;
  /** Fraction of simulations that funded full spending to endAge (never short). */
  successPct: number;
  /** Wilson 95% confidence interval for the success rate [lo, hi]. */
  successCI: [number, number];
  /** Standard error of the success rate. */
  successSE: number;
  /** Gross ending-wealth percentiles across simulations. */
  endingWealth: { p10: number; p25: number; p50: number; p75: number; p90: number };
  /** Mean ending wealth across the WORST 10% of runs (Expected Shortfall / CVaR). */
  cvarEndingWealth: number;
  /** Among runs that fell short: median age the money first ran out (0 if none). */
  medianShortfallAge: number;
  /** Worst real-spending CUT (1 − min real spend ÷ plan) across runs, as fractions:
   *  typical (p50) and bad (p90). ~0 for constant spending; >0 with guardrails. */
  spendCut: { p50: number; p90: number };
  /** Per-year gross-balance percentiles, for a fan chart (10/25/50/75/90). */
  band: { year: number; selfAge: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
  /** Expected (arithmetic-mean) blended annual return assumed. */
  expectedReturn: number;
  /** Blended annual return volatility (1 standard deviation) assumed. */
  volatility: number;
}

/** Deterministic mulberry32 RNG (seeded) so the headline is stable per inputs. */
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

/** Standard-normal sample via Box–Muller. */
function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Lower-triangular Cholesky factor of a (small) correlation matrix. Clamps tiny
 *  negative diagonals to 0 so a hand-entered, near-singular matrix can't NaN. */
function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(0, sum));
      else L[i][j] = L[j][j] > 0 ? sum / L[j][j] : 0;
    }
  }
  return L;
}

/** Linear-interpolated percentile of a sorted array. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Wilson score 95% confidence interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number): { p: number; lo: number; hi: number; se: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 0, se: 0 };
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const se = Math.sqrt((p * (1 - p)) / n);
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half), se };
}

export interface MonteCarloOptions {
  /** Per-class CMAs + correlation matrix (from returnModel). */
  model: ReturnModel;
  runs?: number;
  seed?: number;
  /** Student-t degrees of freedom for fat tails (lower = fatter). Default 6. */
  fatTailDf?: number;
}

export function runMonteCarlo(
  household: Household,
  assumptions: ProjectionAssumptions,
  opts: MonteCarloOptions,
): MonteCarloResult {
  const runs = opts.runs ?? 1000;
  const rng = makeRng(opts.seed ?? 12345);
  // Floor df: a Student-t shock is exponentiated through the lognormal, whose
  // moment-generating function diverges for heavy tails — df below ~5 makes the
  // simulated variance explode. Combined with the winsorization below, this keeps
  // the draw well-behaved.
  const df = Math.max(5, opts.fatTailDf ?? 6);
  const SHOCK_CLAMP = 4; // winsorize the log-space shock to ±4σ (bounds the exp() tail)
  const m = opts.model;

  // Per-class lognormal log-params, moment-matched to each class's arithmetic
  // mean & vol (so simulated SIMPLE returns have the intended mean/vol and can
  // never fall below −100%).
  const classes = [m.assets.equity, m.assets.bonds, m.assets.cash];
  const logp = classes.map((c) => {
    const sig2 = Math.log(1 + (c.vol * c.vol) / ((1 + c.mean) * (1 + c.mean)));
    return { weight: c.weight, muLog: Math.log(1 + c.mean) - sig2 / 2, sd: Math.sqrt(sig2) };
  });
  const L = cholesky(m.corr);
  const tScale = df > 2 ? Math.sqrt((df - 2) / df) : 1; // standardize t to unit variance

  // One correlated, fat-tailed YEAR of asset returns → blended portfolio return.
  const samplePortfolioYear = (): number => {
    const nrm = [randn(rng), randn(rng), randn(rng)];
    // Correlate via Cholesky: z = L · n.
    const z = [
      L[0][0] * nrm[0],
      L[1][0] * nrm[0] + L[1][1] * nrm[1],
      L[2][0] * nrm[0] + L[2][1] * nrm[1] + L[2][2] * nrm[2],
    ];
    // Shared chi-square scaling → multivariate Student-t (systemic fat tails).
    let w = 0;
    for (let k = 0; k < df; k++) {
      const g = randn(rng);
      w += g * g;
    }
    const tFactor = (df > 2 ? Math.sqrt(df / Math.max(w, 1e-9)) : 1) * tScale;
    let port = 0;
    for (let i = 0; i < 3; i++) {
      // Winsorize the standardized shock so a rare extreme t draw can't blow up
      // through exp() (e.g. a +1900% year). Keeps fat tails, bounds the absurd.
      const shock = Math.max(-SHOCK_CLAMP, Math.min(SHOCK_CLAMP, z[i] * tFactor));
      const r = Math.exp(logp[i].muLog + logp[i].sd * shock) - 1;
      port += logp[i].weight * r;
    }
    return port;
  };

  // Compute the recommended-conversion future rate ONCE (deterministic), then
  // reuse it in every run so conversions don't react to the random returns.
  const det = projectLifetime(household, assumptions);
  const futureRateOverride = det.futureRate;

  const endings: number[] = [];
  const shortfallAges: number[] = [];
  const cuts: number[] = []; // worst real-spending cut per run (0 = no cut)
  let successes = 0;
  const cols: number[][] = []; // per-year endTotal across runs

  for (let r = 0; r < runs; r++) {
    const seq: number[] = [];
    const returnFor = (i: number) => (seq[i] ??= samplePortfolioYear());
    const proj = projectLifetime(household, { ...assumptions, returnFor, futureRateOverride });
    endings.push(proj.endingEstate);
    cuts.push(Math.max(0, 1 - proj.minRealSpendRatio));
    if (proj.depleted) {
      const short = proj.rows.find((row) => row.shortfall);
      shortfallAges.push(short ? short.selfAge : det.rows[det.rows.length - 1]?.selfAge ?? 0);
    } else {
      successes++;
    }
    proj.rows.forEach((row, i) => {
      (cols[i] ??= []).push(row.endTotal);
    });
  }

  endings.sort((a, b) => a - b);
  shortfallAges.sort((a, b) => a - b);
  cuts.sort((a, b) => a - b);
  const worstCount = Math.max(1, Math.floor(runs * 0.1));
  const cvar = endings.slice(0, worstCount).reduce((s, x) => s + x, 0) / worstCount;
  const ci = wilsonInterval(successes, runs);

  const band = cols.map((col, i) => {
    col.sort((a, b) => a - b);
    return {
      year: det.rows[i]?.year ?? 0,
      selfAge: det.rows[i]?.selfAge ?? 0,
      p10: pct(col, 0.1),
      p25: pct(col, 0.25),
      p50: pct(col, 0.5),
      p75: pct(col, 0.75),
      p90: pct(col, 0.9),
    };
  });

  return {
    runs,
    successPct: ci.p,
    successCI: [ci.lo, ci.hi],
    successSE: ci.se,
    endingWealth: {
      p10: pct(endings, 0.1),
      p25: pct(endings, 0.25),
      p50: pct(endings, 0.5),
      p75: pct(endings, 0.75),
      p90: pct(endings, 0.9),
    },
    cvarEndingWealth: cvar,
    medianShortfallAge: shortfallAges.length ? pct(shortfallAges, 0.5) : 0,
    spendCut: { p50: pct(cuts, 0.5), p90: pct(cuts, 0.9) },
    band,
    expectedReturn: m.expected,
    volatility: m.volatility,
  };
}
