/**
 * Dividend-income model — projects the dividend stream a portfolio throws off,
 * holding by holding, the way an advisor would rather than assuming income just
 * tracks price.
 *
 * Per-share basis: each holding's income = shares × dividend-per-share (DPS),
 * with DPS auto-filled from the market feed (trailing-12-month dividends) and the
 * recent dividend-growth rate from its payout history — both user-overridable.
 *
 * GROWTH MODEL (blend per holding):
 *  - Individual stocks: a two-stage / H-style path — the recent (high) growth
 *    rate fades LINEARLY to a sustainable long-run rate over a fade window, then
 *    holds. Mirrors the multi-stage dividend-discount models CFAs use: no company
 *    compounds its dividend at 12% forever.
 *  - Broad funds (ETF / mutual fund): constant (Gordon) growth at the fund's own
 *    historical dividend-growth rate, lightly capped — honest for a diversified
 *    index, which doesn't have a "high-growth fade."
 *  - Bond funds: ~0% nominal dividend growth (distributions track yield, not a
 *    rising payout); taxed as ordinary income.
 *
 * TAX CHARACTER: stock / ETF / mutual-fund payouts are treated as QUALIFIED
 * dividends (preferential rate); bond-fund distributions as ORDINARY dividends.
 * Cash is excluded here — its interest is modeled separately.
 *
 * ⚠️ Educational estimates only. Growth assumptions are modeled, not guaranteed.
 */

import { Holding, HoldingType, Household, bucketOf } from "./accounts";

/** Long-run sustainable dividend growth a high-grower fades toward (nominal). */
export const LONG_RUN_DIV_GROWTH = 0.05;
/** Years over which an individual stock's high growth fades to the long-run rate. */
export const FADE_YEARS = 10;
/** Caps so a fetched outlier can't produce absurd compounding. */
const STOCK_GROWTH_CAP = 0.12;
const FUND_GROWTH_CAP = 0.08;

/** Fallback assumptions when a holding has no fetched/entered dividend data:
 *  a typical current yield and a steady growth rate by asset type. */
const TYPE_DEFAULTS: Record<HoldingType, { yield: number; growth: number }> = {
  stock: { yield: 0.015, growth: 0.08 },
  etf: { yield: 0.017, growth: 0.06 },
  mutual_fund: { yield: 0.018, growth: 0.06 },
  bond_fund: { yield: 0.035, growth: 0.0 },
  cash: { yield: 0.0, growth: 0.0 },
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Does this holding pay a dividend we model (everything but cash)? */
export function paysDividend(type: HoldingType): boolean {
  return type !== "cash";
}

/** Tax character of a holding's payout, by TYPE (the default). */
export function dividendKind(type: HoldingType): "qualified" | "ordinary" | "none" {
  if (type === "cash") return "none";
  if (type === "bond_fund") return "ordinary"; // bond distributions are ordinary income
  return "qualified"; // stock / etf / mutual fund — usually qualified
}

/** Tax character of a SPECIFIC holding, honoring the user's per-holding override
 *  (e.g. a REIT or non-qualified fund flagged ordinary). Cash is never a dividend. */
export function holdingDividendKind(h: Holding): "qualified" | "ordinary" | "none" {
  if (h.type === "cash") return "none";
  if (h.dividendOrdinary === true) return "ordinary";
  if (h.dividendOrdinary === false) return "qualified";
  return dividendKind(h.type);
}

/** This holding's annual dividend per share — entered/fetched, else a type default
 *  applied to the current price. */
export function holdingDps(h: Holding): number {
  if (h.dividendPerShare != null && h.dividendPerShare >= 0) return h.dividendPerShare;
  return h.price * TYPE_DEFAULTS[h.type].yield;
}

/** This holding's recent annual dividend-growth rate — entered/fetched, else type default. */
export function holdingDivGrowth(h: Holding): number {
  if (h.dividendGrowthRate != null) return h.dividendGrowthRate;
  return TYPE_DEFAULTS[h.type].growth;
}

/** Current-year dividend income from one holding (shares × DPS). */
export function holdingDividendIncome(h: Holding): number {
  if (!paysDividend(h.type)) return 0;
  return h.shares * holdingDps(h);
}

/** The modeled dividend-growth rate applied in year τ (1-indexed) for a holding
 *  type whose recent growth is g0. Implements the blend: linear fade for stocks,
 *  constant for funds, zero for bonds. */
export function growthAtYear(type: HoldingType, g0: number, tau: number): number {
  if (type === "bond_fund" || type === "cash") return 0;
  if (type === "stock") {
    const gHigh = clamp(g0, 0, STOCK_GROWTH_CAP);
    if (tau >= FADE_YEARS) return LONG_RUN_DIV_GROWTH;
    // Linear fade from gHigh (year 1) to the long-run rate (year FADE_YEARS).
    return gHigh + (LONG_RUN_DIV_GROWTH - gHigh) * ((tau - 1) / (FADE_YEARS - 1));
  }
  // Broad funds: constant (Gordon) growth at the fund's own rate, capped.
  return clamp(g0, 0, FUND_GROWTH_CAP);
}

/** Cumulative DPS growth multiple at year t (DPS(t) / DPS(0)) for one holding. */
export function dpsGrowthFactor(h: Holding, t: number): number {
  if (t <= 0) return 1;
  const g0 = holdingDivGrowth(h);
  let factor = 1;
  for (let tau = 1; tau <= t; tau++) factor *= 1 + growthAtYear(h.type, g0, tau);
  return factor;
}

export interface DividendBreakdown {
  /** Per-holding current income, sorted desc, with yield + modeled growth. */
  holdings: {
    ticker: string;
    name: string;
    type: HoldingType;
    shares: number;
    dps: number;
    income: number;
    yieldPct: number;
    growth: number;
    kind: "qualified" | "ordinary" | "none";
  }[];
  qualifiedYear0: number;
  ordinaryYear0: number;
  totalYear0: number;
  /** Whether ANY holding carries real (fetched/entered) dividend data — if not,
   *  callers should fall back to entered household totals rather than this model. */
  hasData: boolean;
}

/** Summarize the dividend picture across a set of (taxable) holdings at year 0. */
export function dividendBreakdown(holdings: Holding[]): DividendBreakdown {
  const rows = holdings
    .filter((h) => paysDividend(h.type))
    .map((h) => {
      const dps = holdingDps(h);
      const income = h.shares * dps;
      const value = h.shares * h.price;
      return {
        ticker: h.ticker,
        name: h.name,
        type: h.type,
        shares: h.shares,
        dps,
        income,
        yieldPct: value > 0 ? income / value : 0,
        growth: holdingDivGrowth(h),
        kind: holdingDividendKind(h),
      };
    })
    .sort((a, b) => b.income - a.income);
  const qualifiedYear0 = rows.filter((r) => r.kind === "qualified").reduce((s, r) => s + r.income, 0);
  const ordinaryYear0 = rows.filter((r) => r.kind === "ordinary").reduce((s, r) => s + r.income, 0);
  const hasData = holdings.some((h) => h.dividendPerShare != null);
  return { holdings: rows, qualifiedYear0, ordinaryYear0, totalYear0: qualifiedYear0 + ordinaryYear0, hasData };
}

/** Income-weighted cumulative DPS growth factor at year t for a tax-character
 *  bucket ("qualified" or "ordinary") — what the engine multiplies the year-0
 *  base income by to grow the stream (separate from share drawdown). Returns 1
 *  when that bucket is empty. */
export function bucketGrowthFactor(holdings: Holding[], kind: "qualified" | "ordinary", t: number): number {
  const inBucket = holdings.filter((h) => holdingDividendKind(h) === kind);
  let base = 0;
  let grown = 0;
  for (const h of inBucket) {
    const inc0 = h.shares * holdingDps(h);
    base += inc0;
    grown += inc0 * dpsGrowthFactor(h, t);
  }
  return base > 0 ? grown / base : 1;
}

/** Total projected dividend income (qualified + ordinary, nominal) by year offset
 *  0..years, holding SHARES constant — for the forecast view. Does not model
 *  selling shares (the lifetime projection layers drawdown on top). */
export function dividendIncomeTrajectory(
  holdings: Holding[],
  years: number,
): { year: number; qualified: number; ordinary: number; total: number }[] {
  const out: { year: number; qualified: number; ordinary: number; total: number }[] = [];
  for (let t = 0; t <= years; t++) {
    let qualified = 0;
    let ordinary = 0;
    for (const h of holdings) {
      const k = holdingDividendKind(h);
      if (k === "none") continue;
      const inc = h.shares * holdingDps(h) * dpsGrowthFactor(h, t);
      if (k === "qualified") qualified += inc;
      else ordinary += inc;
    }
    out.push({ year: t, qualified, ordinary, total: qualified + ordinary });
  }
  return out;
}

/** Single source of truth: when a household's TAXABLE holdings carry real dividend
 *  data, the household's qualified (brokerageDividendsAnnual) and ordinary
 *  (ordinaryDividendsAnnual) dividend totals are DERIVED from them — so the tax
 *  engine, the planner, and every view use the same per-share-based numbers rather
 *  than a stale entered total. Dividends inside IRA/401(k)/Roth (non-taxable)
 *  accounts are excluded — they aren't taxed yearly. Returns the SAME object when
 *  there's no holdings data or the totals already match (ref-stable for memo). */
export function syncHouseholdDividends(household: Household): Household {
  const taxableHoldings = household.accounts
    .filter((a) => bucketOf(a.kind) === "taxable")
    .flatMap((a) => a.holdings ?? []);
  const bd = dividendBreakdown(taxableHoldings);
  if (!bd.hasData) return household;
  const q = Math.round(bd.qualifiedYear0);
  const o = Math.round(bd.ordinaryYear0);
  if (Math.abs((household.brokerageDividendsAnnual ?? 0) - q) < 1 && Math.abs((household.ordinaryDividendsAnnual ?? 0) - o) < 1) {
    return household;
  }
  return { ...household, brokerageDividendsAnnual: q, ordinaryDividendsAnnual: o };
}
