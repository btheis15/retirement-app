/**
 * "Most money" ranking by PROBABILITY across simulated markets.
 *
 * For the maxCapital goal the right question isn't "which plan wins on one assumed
 * return?" but "which plan most likely leaves you the most?" So we replay the SAME
 * simulated market paths (common random numbers) through EVERY candidate plan and
 * score each three ways the user can choose between:
 *   • winRate — the share of markets in which this plan ends RICHEST of all
 *     candidates (the most literal "highest probability of giving you the most").
 *   • median  — its typical (50th-pct) after-tax ending estate (robust to extremes).
 *   • mean    — its average (upside-weighted) after-tax ending estate.
 *
 * Common random numbers remove the market as a confounder, so the ranking reflects
 * the PLANS, not luck. Mirrors lib/monteCarlo.ts / lib/compareMonteCarlo.ts path
 * generation EXACTLY (multi-asset fat-tailed Student-t draws + AR(1) inflation);
 * keep them in sync if the return model changes.
 *
 * ⚠️ Educational estimates only — not advice.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";
import { randn, cholesky } from "./monteCarlo";
import { ROBUST_LTCG_RATE } from "./goals";

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

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export type MostMoneyMetric = "winRate" | "median" | "mean";

export interface MostMoneyStat {
  /** Share of common-random-number markets in which this plan ends RICHEST —
   *  judged on the step-up-ROBUST estate (brokerage gain taxed at 15%), so a
   *  plan can't win purely on the all-or-nothing basis-step-up bet. */
  winRate: number;
  /** After-tax ending estate (today's dollars) across markets. */
  median: number;
  mean: number;
  p10: number;
  /** Share of markets funding full spending to the end (not depleted). */
  success: number;
}

export interface MostMoneyOptions {
  model: ReturnModel;
  runs?: number;
  seed?: number;
  fatTailDf?: number;
}

/**
 * Score each candidate plan across identical simulated markets. Returns one stat
 * per candidate, aligned to the input order. The caller ranks by the chosen metric.
 */
export function rankMostMoney(
  household: Household,
  candidates: ProjectionAssumptions[],
  opts: MostMoneyOptions,
): MostMoneyStat[] {
  const N = candidates.length;
  if (N === 0) return [];
  const runs = opts.runs ?? 600;
  const rng = makeRng(opts.seed ?? 12345);
  const df = Math.max(5, opts.fatTailDf ?? 6);
  const SHOCK_CLAMP = 4;
  const m = opts.model;

  const classes = [m.assets.equity, m.assets.bonds, m.assets.cash];
  const logp = classes.map((c) => {
    const sig2 = Math.log(1 + (c.vol * c.vol) / ((1 + c.mean) * (1 + c.mean)));
    return { weight: c.weight, muLog: Math.log(1 + c.mean) - sig2 / 2, sd: Math.sqrt(sig2) };
  });
  const INFL_CORR = { eq: -0.01, bonds: -0.24, cash: -0.03 };
  const c3 = m.corr;
  const corr4 = [
    [c3[0][0], c3[0][1], c3[0][2], INFL_CORR.eq],
    [c3[1][0], c3[1][1], c3[1][2], INFL_CORR.bonds],
    [c3[2][0], c3[2][1], c3[2][2], INFL_CORR.cash],
    [INFL_CORR.eq, INFL_CORR.bonds, INFL_CORR.cash, 1],
  ];
  const L = cholesky(corr4);
  const tScale = df > 2 ? Math.sqrt((df - 2) / df) : 1;
  // Common-random-numbers requires ONE shared inflation path, so the FIRST
  // plan's inflationRate seeds it; any other plan's differing rate is ignored
  // by design (callers compare plans under identical assumptions).
  const pibar = candidates[0].inflationRate;
  const PHI = 0.6;
  const SIGMA_INFL = 0.0177;
  const sigmaEps = SIGMA_INFL * Math.sqrt(1 - PHI * PHI);

  // Future RMD-era rate per candidate (deterministic), so conversions are sized
  // against the household's real future rate, not the noisy simulated returns.
  const futureRates = candidates.map((a) => projectLifetime(household, a).futureRate);

  const ends: number[][] = candidates.map(() => []);
  const wins = new Array<number>(N).fill(0);
  const success = new Array<number>(N).fill(0);

  for (let r = 0; r < runs; r++) {
    const rets: number[] = [];
    const infls: number[] = [];
    // Seed the AR(1) from its STATIONARY distribution (sd = sigma/sqrt(1-phi^2)),
    // not from the mean — starting at the mean understates inflation risk exactly
    // in the sequence-risk-critical first years of retirement.
    let prevInfl = pibar + (sigmaEps / Math.sqrt(1 - PHI * PHI)) * randn(rng);
    const ensure = (i: number) => {
      while (rets.length <= i) {
        const n = [randn(rng), randn(rng), randn(rng), randn(rng)];
        const z = [0, 0, 0, 0];
        for (let a = 0; a < 4; a++) {
          let s = 0;
          for (let b = 0; b <= a; b++) s += L[a][b] * n[b];
          z[a] = s;
        }
        let w = 0;
        for (let k = 0; k < df; k++) {
          const g = randn(rng);
          w += g * g;
        }
        const tFactor = (df > 2 ? Math.sqrt(df / Math.max(w, 1e-9)) : 1) * tScale;
        let port = 0;
        for (let i = 0; i < 3; i++) {
          const shock = Math.max(-SHOCK_CLAMP, Math.min(SHOCK_CLAMP, z[i] * tFactor));
          port += logp[i].weight * (Math.exp(logp[i].muLog + logp[i].sd * shock) - 1);
        }
        const infl = Math.max(-0.02, Math.min(0.12, pibar + PHI * (prevInfl - pibar) + sigmaEps * z[3]));
        prevInfl = infl;
        rets.push(port);
        infls.push(infl);
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

    // EVERY candidate is projected on the SAME generated path (common random numbers).
    // Two readings of each outcome: the DISPLAYED after-tax estate (full brokerage
    // step-up, matching every other screen), and a ROBUST variant that taxes the
    // unrealized brokerage gain at 15% instead of assuming the step-up. Wins are
    // awarded on the robust number — same guard the deterministic ranking applies —
    // so a plan can't win the probability ranking purely on the all-or-nothing
    // step-up bet.
    const outcomes: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = projectLifetime(household, {
        ...candidates[i],
        returnFor,
        inflationFor,
        futureRateOverride: futureRates[i],
      });
      const deflator = p.endDeflator > 0 ? p.endDeflator : 1;
      outcomes[i] = Math.max(0, p.endingEstateAfterTaxReal - (ROBUST_LTCG_RATE * p.endingBuckets.taxableGain) / deflator);
      ends[i].push(p.endingEstateAfterTaxReal);
      if (!p.depleted) success[i]++;
    }
    // Award the path to the richest plan(s); split ties so winRates sum to 1.
    let max = -Infinity;
    for (const o of outcomes) if (o > max) max = o;
    const winners: number[] = [];
    for (let i = 0; i < N; i++) if (outcomes[i] >= max - 1) winners.push(i);
    const share = 1 / winners.length;
    for (const i of winners) wins[i] += share;
  }

  return candidates.map((_, i) => {
    const s = [...ends[i]].sort((x, y) => x - y);
    return {
      winRate: wins[i] / runs,
      median: percentile(s, 0.5),
      mean: s.reduce((acc, x) => acc + x, 0) / s.length,
      p10: percentile(s, 0.1),
      success: success[i] / runs,
    };
  });
}

/** Index of the best candidate under a chosen metric (ties → lowest index). */
export function argmaxByMetric(stats: MostMoneyStat[], metric: MostMoneyMetric): number {
  let best = 0;
  for (let i = 1; i < stats.length; i++) {
    if (stats[i][metric] > stats[best][metric]) best = i;
  }
  return best;
}
