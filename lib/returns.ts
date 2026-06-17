/**
 * Return assumptions derived from the household's ACTUAL holdings, blended from
 * forward-looking capital-market assumptions (CMAs) rather than a backward-
 * looking ~10% equity average. We classify each holding into equity / bonds /
 * cash, then expose BOTH a blended headline (expected return + portfolio
 * volatility from the full covariance) AND the per-class parameters + a
 * correlation matrix, so the Monte-Carlo engine can draw the three asset classes
 * JOINTLY (correlated) instead of from one scalar blend.
 *
 * CMAs (arithmetic-mean NOMINAL annual return + annual stdev): J.P. Morgan 2026
 * Long-Term Capital Market Assumptions, cross-checked vs. Vanguard VCMM and
 * Morningstar — US large-cap equity 7.94% / 16.47%, US aggregate bonds 4.91% /
 * 4.76%, cash 3.10% / 0.67%. These are FORWARD estimates (lower than the ~10%
 * historical equity mean at today's valuations) — the honest, high-end default.
 *
 * ⚠️ Educational estimates only. Past performance ≠ future results; actual
 * returns vary widely year to year (and sequence-of-returns matters).
 */

import { Account, holdingValue } from "./accounts";

/** Per-class forward CMAs: arithmetic-mean nominal return and annual stdev. */
export const CMA = {
  equity: { mean: 0.0794, vol: 0.1647 },
  bonds: { mean: 0.0491, vol: 0.0476 },
  cash: { mean: 0.031, vol: 0.0067 },
} as const;

/** Correlation matrix over [equity, bonds, cash]. eq–bond is the POST-2022
 *  POSITIVE regime (+0.16), not the −0.3 of 2000–2020 — so the sim can produce
 *  years where stocks AND bonds fall together (the 2022 / near-retiree threat). */
export const ASSET_CORR: number[][] = [
  [1.0, 0.16, 0.01],
  [0.16, 1.0, 0.1],
  [0.01, 0.1, 1.0],
];

/** Back-compat scalar means/stdevs (derived from the CMA table). */
export const ASSET_RETURN = { equity: CMA.equity.mean, bonds: CMA.bonds.mean, cash: CMA.cash.mean } as const;
export const ASSET_STDEV = { equity: CMA.equity.vol, bonds: CMA.bonds.vol, cash: CMA.cash.vol } as const;

/** Allocation assumed for accounts that have a balance but no itemized holdings
 *  (and aren't a cash account): a generic diversified mix. */
const ASSUMED_MIX = { equity: 0.7, bonds: 0.25, cash: 0.05 };

export interface AssetClassParams {
  /** Portfolio weight (0–1). */
  weight: number;
  /** Arithmetic-mean nominal annual return. */
  mean: number;
  /** Annual return standard deviation. */
  vol: number;
}

export interface ReturnModel {
  equityPct: number;
  bondPct: number;
  cashPct: number;
  /** Blended ARITHMETIC-mean nominal expected return (what the Monte-Carlo draws
   *  around; the right single-period expectation). */
  expected: number;
  /** Blended GEOMETRIC (compound) return ≈ expected − ½·vol² — the rate to
   *  COMPOUND in a deterministic year-by-year projection. Compounding the
   *  arithmetic mean overstates the median path by ~½·vol²/yr. */
  expectedGeometric: number;
  conservative: number;
  optimistic: number;
  /** Blended annual return standard deviation, from the FULL covariance matrix. */
  volatility: number;
  /** Per-class weight + CMA params, for the Monte-Carlo multi-asset draw. */
  assets: { equity: AssetClassParams; bonds: AssetClassParams; cash: AssetClassParams };
  /** Correlation matrix over [equity, bonds, cash]. */
  corr: number[][];
  /** Whether the mix came from real holdings, assumptions, or both. */
  basis: "holdings" | "assumed" | "mixed";
}

const round1 = (x: number) => Math.round(x * 1000) / 1000; // nearest 0.1%

/** Portfolio variance from weights w and per-class vols σ with correlation ρ. */
function portfolioVariance(w: number[], vol: number[], corr: number[][]): number {
  let v = 0;
  for (let i = 0; i < w.length; i++) {
    for (let j = 0; j < w.length; j++) {
      v += w[i] * w[j] * vol[i] * vol[j] * corr[i][j];
    }
  }
  return v;
}

export function returnModel(accounts: Account[]): ReturnModel {
  let eq = 0;
  let bd = 0;
  let ca = 0;
  let holdingsUsed = false;
  let assumedUsed = false;

  for (const a of accounts) {
    if (a.holdings && a.holdings.length > 0) {
      holdingsUsed = true;
      for (const h of a.holdings) {
        const v = holdingValue(h);
        if (h.type === "bond_fund") bd += v;
        else if (h.type === "cash") ca += v;
        else eq += v; // stock, etf, mutual_fund → equity
      }
    } else if (a.kind === "cash") {
      ca += a.balance;
    } else if (a.balance > 0) {
      assumedUsed = true;
      eq += a.balance * ASSUMED_MIX.equity;
      bd += a.balance * ASSUMED_MIX.bonds;
      ca += a.balance * ASSUMED_MIX.cash;
    }
  }

  const total = eq + bd + ca;
  const mkAssets = (we: number, wb: number, wc: number) => ({
    equity: { weight: we, mean: CMA.equity.mean, vol: CMA.equity.vol },
    bonds: { weight: wb, mean: CMA.bonds.mean, vol: CMA.bonds.vol },
    cash: { weight: wc, mean: CMA.cash.mean, vol: CMA.cash.vol },
  });

  // Weights: real mix, or a generic diversified mix when there's nothing entered
  // (so the fallback is derived from the SAME formula, never hand-typed).
  const empty = total <= 0;
  const equityPct = empty ? 0.7 : eq / total;
  const bondPct = empty ? 0.25 : bd / total;
  const cashPct = empty ? 0.05 : ca / total;
  const w = [equityPct, bondPct, cashPct];
  const vols = [CMA.equity.vol, CMA.bonds.vol, CMA.cash.vol];

  const expected = round1(equityPct * CMA.equity.mean + bondPct * CMA.bonds.mean + cashPct * CMA.cash.mean);
  const volatility = round1(Math.sqrt(portfolioVariance(w, vols, ASSET_CORR)));
  // Geometric (compound) return = the arithmetic mean minus the variance drag.
  // This is what a deterministic projection should compound, year over year.
  const expectedGeometric = round1(expected - (volatility * volatility) / 2);
  // Bracket the COMPOUND return (these feed the deterministic scenario rates),
  // perturbing the equity contribution ~±1.5%.
  const conservative = round1(Math.max(0.015, expectedGeometric - 0.015 - equityPct * 0.01));
  const optimistic = round1(expectedGeometric + 0.015 + equityPct * 0.01);
  const basis = empty ? "assumed" : holdingsUsed && assumedUsed ? "mixed" : holdingsUsed ? "holdings" : "assumed";

  return {
    equityPct, bondPct, cashPct, expected, expectedGeometric, conservative, optimistic, volatility,
    assets: mkAssets(equityPct, bondPct, cashPct), corr: ASSET_CORR, basis,
  };
}
