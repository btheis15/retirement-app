/**
 * Return assumptions derived from the household's ACTUAL holdings, not arbitrary
 * cards. We classify each holding into equity / bonds / cash, blend long-run
 * asset-class returns by the portfolio's allocation, then bracket that blend.
 *
 * Long-run NOMINAL return assumptions (before inflation):
 *  - Equity (stocks, ETFs, equity mutual funds): ~10%/yr — the long-run U.S.
 *    large-cap average with dividends reinvested.
 *  - Bonds (bond funds): ~4.5%/yr.
 *  - Cash / CDs / savings: ~3%/yr.
 *
 * ⚠️ Educational estimates only. Past performance ≠ future results; actual
 * returns vary widely year to year (and sequence-of-returns matters).
 */

import { Account, holdingValue } from "./accounts";

export const ASSET_RETURN = { equity: 0.1, bonds: 0.045, cash: 0.03 } as const;

/** Long-run nominal annual return standard deviations, by asset class — used by
 *  the Monte-Carlo "probability of success" simulation. Educational estimates. */
export const ASSET_STDEV = { equity: 0.17, bonds: 0.05, cash: 0.01 } as const;
/** Approximate equity↔bond correlation for blending portfolio volatility. */
const RHO_EQ_BD = 0.15;

/** Allocation assumed for accounts that have a balance but no itemized holdings
 *  (and aren't a cash account): a generic diversified mix. */
const ASSUMED_MIX = { equity: 0.7, bonds: 0.25, cash: 0.05 };

export interface ReturnModel {
  equityPct: number;
  bondPct: number;
  cashPct: number;
  /** Blended long-run nominal expected return. */
  expected: number;
  conservative: number;
  optimistic: number;
  /** Blended annual return standard deviation (for Monte Carlo). */
  volatility: number;
  /** Whether the mix came from real holdings, assumptions, or both. */
  basis: "holdings" | "assumed" | "mixed";
}

const round1 = (x: number) => Math.round(x * 1000) / 1000; // nearest 0.1%

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
  if (total <= 0) {
    return { equityPct: 0, bondPct: 0, cashPct: 0, expected: 0.06, conservative: 0.04, optimistic: 0.08, volatility: 0.1, basis: "assumed" };
  }

  const equityPct = eq / total;
  const bondPct = bd / total;
  const cashPct = ca / total;
  const expected = round1(equityPct * ASSET_RETURN.equity + bondPct * ASSET_RETURN.bonds + cashPct * ASSET_RETURN.cash);
  // Bracket the blend: a weak run vs a strong run around the expected.
  const conservative = round1(Math.max(0.02, expected - 0.035));
  const optimistic = round1(expected + 0.025);
  // Portfolio volatility: blend asset-class variances with one equity↔bond correlation.
  const se = equityPct * ASSET_STDEV.equity;
  const sb = bondPct * ASSET_STDEV.bonds;
  const sc = cashPct * ASSET_STDEV.cash;
  const variance = se * se + sb * sb + sc * sc + 2 * RHO_EQ_BD * se * sb;
  const volatility = round1(Math.sqrt(variance));
  const basis = holdingsUsed && assumedUsed ? "mixed" : holdingsUsed ? "holdings" : "assumed";

  return { equityPct, bondPct, cashPct, expected, conservative, optimistic, volatility, basis };
}
