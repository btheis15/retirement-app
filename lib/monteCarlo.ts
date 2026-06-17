/**
 * Monte-Carlo "probability of success" — the standard retirement confidence
 * metric. Reruns the lifetime projection many times with RANDOM annual returns
 * (instead of one flat rate) drawn from the portfolio's expected return and
 * volatility, and reports how often the plan funds full spending to the end,
 * plus the range of outcomes.
 *
 * Sequence-of-returns risk emerges naturally: each year withdraws before it
 * grows, so an unlucky early run can fall short even at the same average return.
 *
 * A FIXED seed is used by default so the headline percent is stable between
 * renders (it only moves when the plan/inputs change), which keeps the UI clean.
 *
 * ⚠️ Educational estimates only. Returns are modeled as independent lognormal
 * draws (no fat tails or autocorrelation) — directional, not a guarantee.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";

export interface MonteCarloResult {
  runs: number;
  /** Fraction of simulations that funded full spending to endAge (never short). */
  successPct: number;
  /** Gross ending-wealth percentiles across simulations. */
  endingWealth: { p10: number; p25: number; p50: number; p75: number; p90: number };
  /** Per-year gross-balance percentiles, for a fan chart (10/25/50/75/90). */
  band: { year: number; selfAge: number; p10: number; p25: number; p50: number; p75: number; p90: number }[];
  /** Expected (arithmetic-mean) annual return assumed. */
  expectedReturn: number;
  /** Annual return volatility (1 standard deviation) assumed. */
  volatility: number;
}

/** Deterministic mulberry32 RNG (seeded) so the result is stable per inputs. */
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

/** Linear-interpolated percentile of a sorted array. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface MonteCarloOptions {
  expected: number; // arithmetic-mean nominal return
  volatility: number; // annual stdev
  runs?: number;
  seed?: number;
}

export function runMonteCarlo(
  household: Household,
  assumptions: ProjectionAssumptions,
  opts: MonteCarloOptions,
): MonteCarloResult {
  const runs = opts.runs ?? 400;
  const rng = makeRng(opts.seed ?? 12345);
  const mu = opts.expected;
  const sigma = opts.volatility;

  // Lognormal params chosen so the arithmetic mean stays `mu` and stdev `sigma`,
  // while a draw can never fall below -100%.
  const sig2 = Math.log(1 + (sigma * sigma) / ((1 + mu) * (1 + mu)));
  const muLog = Math.log(1 + mu) - sig2 / 2;
  const sd = Math.sqrt(sig2);
  const sample = () => Math.exp(muLog + sd * randn(rng)) - 1;

  // Compute the recommended-conversion future rate ONCE (deterministic), then
  // reuse it in every run so conversions don't react to the random returns.
  const det = projectLifetime(household, assumptions);
  const futureRateOverride = det.futureRate;

  const endings: number[] = [];
  let successes = 0;
  const cols: number[][] = []; // per-year endTotal across runs

  for (let r = 0; r < runs; r++) {
    const seq: number[] = [];
    const returnFor = (i: number) => (seq[i] ??= sample());
    const proj = projectLifetime(household, { ...assumptions, returnFor, futureRateOverride });
    endings.push(proj.endingEstate);
    if (!proj.depleted) successes++;
    proj.rows.forEach((row, i) => {
      (cols[i] ??= []).push(row.endTotal);
    });
  }

  endings.sort((a, b) => a - b);
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
    successPct: runs > 0 ? successes / runs : 0,
    endingWealth: {
      p10: pct(endings, 0.1),
      p25: pct(endings, 0.25),
      p50: pct(endings, 0.5),
      p75: pct(endings, 0.75),
      p90: pct(endings, 0.9),
    },
    band,
    expectedReturn: mu,
    volatility: sigma,
  };
}
