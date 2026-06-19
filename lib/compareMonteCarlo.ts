/**
 * Paired ("common random numbers") Monte-Carlo head-to-head between two plans.
 *
 * The honest way to answer "what are the ODDS plan A beats plan B?" is to replay
 * the SAME market history through BOTH plans, run after run, and count how often
 * A ends richer than B. Using identical draws (common random numbers) removes the
 * market as a confounder, so the win-rate reflects the PLANS, not luck — and it's
 * a massive variance reduction vs. comparing two independent simulations.
 *
 * This mirrors lib/monteCarlo.ts's path generation EXACTLY (same multi-asset,
 * fat-tailed Student-t draws + AR(1) inflation), then projects both plans on each
 * generated path. Keep the two in sync if the return model changes.
 *
 * ⚠️ Educational estimates only — not advice.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";
import { randn, cholesky } from "./monteCarlo";

/** Deterministic mulberry32 RNG (seeded) — a local copy of monteCarlo.ts's, so a
 *  given seed reproduces the same market paths run-to-run for a stable head-to-head. */
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

export interface PairedResult {
  runs: number;
  /** Fraction of runs where each plan funded full spending to the end. */
  successA: number;
  successB: number;
  /** Head-to-head on after-tax ending estate (today's dollars), SAME market path
   *  each run: fraction where A ends strictly richer, B richer, or a dead heat. */
  aWins: number;
  bWins: number;
  ties: number;
  /** Distribution of (A − B) after-tax ending estate in today's dollars. A positive
   *  median means A typically wins; the p10 shows how bad it gets when B wins. */
  margin: { p10: number; p50: number; p90: number; mean: number };
  /** After-tax ending estate percentiles in today's dollars, each plan. */
  endA: { p10: number; p50: number; p90: number; cvar10: number };
  endB: { p10: number; p50: number; p90: number; cvar10: number };
  /** In the worst 10% of markets (ranked by A's outcome), how often B does better —
   *  i.e. is the "simpler" plan a safer bet precisely when markets disappoint? */
  bWinsInWorstDecile: number;
}

export interface PairedOptions {
  model: ReturnModel;
  runs?: number;
  seed?: number;
  fatTailDf?: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Run two plans through identical market paths and report the head-to-head odds. */
export function runPairedMonteCarlo(
  household: Household,
  assumptionsA: ProjectionAssumptions,
  assumptionsB: ProjectionAssumptions,
  opts: PairedOptions,
): PairedResult {
  const runs = opts.runs ?? 800;
  const rng = makeRng(opts.seed ?? 12345);
  const df = Math.max(5, opts.fatTailDf ?? 6);
  const SHOCK_CLAMP = 4;
  const m = opts.model;

  // Per-class lognormal log-params, moment-matched to each class's arithmetic
  // mean & vol — identical to runMonteCarlo.
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

  const pibar = assumptionsA.inflationRate;
  const PHI = 0.6;
  const SIGMA_INFL = 0.0177;
  const sigmaEps = SIGMA_INFL * Math.sqrt(1 - PHI * PHI);

  // Future RMD-era rate for recommended-mode conversions, computed once per plan
  // (deterministic), so conversions don't chase the random returns.
  const detA = projectLifetime(household, assumptionsA);
  const detB = projectLifetime(household, assumptionsB);

  const endA: number[] = [];
  const endB: number[] = [];
  const margins: number[] = [];
  let successA = 0;
  let successB = 0;
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  // pair (A-outcome, B-outcome) kept to find B's win-rate in A's worst decile.
  const pairs: { a: number; b: number }[] = [];

  for (let r = 0; r < runs; r++) {
    const rets: number[] = [];
    const infls: number[] = [];
    let prevInfl = pibar;
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
    // SAME path object for both plans → a fair, paired comparison.
    const pA = projectLifetime(household, { ...assumptionsA, returnFor, inflationFor, futureRateOverride: detA.futureRate });
    const pB = projectLifetime(household, { ...assumptionsB, returnFor, inflationFor, futureRateOverride: detB.futureRate });
    const a = pA.endingEstateAfterTaxReal;
    const b = pB.endingEstateAfterTaxReal;
    endA.push(a);
    endB.push(b);
    margins.push(a - b);
    pairs.push({ a, b });
    if (!pA.depleted) successA++;
    if (!pB.depleted) successB++;
    // "Even if small": any strictly-better outcome counts; treat sub-$1 (today's $)
    // gaps as ties (e.g. both depleted to $0).
    if (a - b > 1) aWins++;
    else if (b - a > 1) bWins++;
    else ties++;
  }

  const sortAsc = (xs: number[]) => [...xs].sort((x, y) => x - y);
  const sA = sortAsc(endA);
  const sB = sortAsc(endB);
  const sM = sortAsc(margins);
  const worst = Math.max(1, Math.floor(runs * 0.1));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  // B's win-rate within A's worst decile (the markets where A disappoints most).
  const byA = [...pairs].sort((x, y) => x.a - y.a).slice(0, worst);
  const bWinsInWorstDecile = byA.length ? byA.filter((p) => p.b - p.a > 1).length / byA.length : 0;

  return {
    runs,
    successA: successA / runs,
    successB: successB / runs,
    aWins: aWins / runs,
    bWins: bWins / runs,
    ties: ties / runs,
    margin: { p10: percentile(sM, 0.1), p50: percentile(sM, 0.5), p90: percentile(sM, 0.9), mean: mean(margins) },
    endA: { p10: percentile(sA, 0.1), p50: percentile(sA, 0.5), p90: percentile(sA, 0.9), cvar10: mean(sA.slice(0, worst)) },
    endB: { p10: percentile(sB, 0.1), p50: percentile(sB, 0.5), p90: percentile(sB, 0.9), cvar10: mean(sB.slice(0, worst)) },
    bWinsInWorstDecile,
  };
}
