// Yahoo Finance → per-symbol INCOME dividend-per-share (DPS), a dividend-growth
// rate, and an estimated annual CAPITAL-GAINS DISTRIBUTION per share. Given
// ?symbols=AAPL,VWNAX it returns, per symbol, the clean trailing income DPS, a
// ~5-year dividend-growth CAGR, and (for funds that throw off cap-gain
// distributions) a smoothed average cap-gain distribution — used to seed the
// per-holding dividend model (the user can override any of it).
//
// WHY TWO SOURCES. Yahoo's public chart endpoint reports a mutual fund's
// year-end "dividend" event as ONE lumped number = income dividend + short-term
// cap-gain distribution + long-term cap-gain distribution (e.g. VWNAX Dec-2025:
// 0.7112 + 0.5038 + 7.6723 = 8.887). Treating that whole lump as a qualified
// dividend — and worse, growing it forever — massively overstates recurring
// dividend income and mis-taxes it. So:
//   • INCOME dividend  = dividendYield × price from the quote endpoint (the clean
//     income yield Yahoo itself displays; excludes cap-gain distributions).
//   • CAP-GAIN dist    = avg annual TOTAL distributions (chart) − income dividend.
//     Cap-gain distributions swing wildly year to year, so we AVERAGE several
//     years rather than project one lumpy year — and we hold it flat (no growth),
//     unlike the income dividend which follows a dividend-growth model.
//
// The quote endpoint needs a Yahoo crumb+cookie; the chart endpoint doesn't. We
// cache the crumb in module scope and fall back to chart-only if it's unavailable.
//
// PRIVACY: only ticker SYMBOLS are sent here (and on to Yahoo) — never share
// counts, balances, ages, or identity. We do not log the request.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DivInfo {
  symbol: string;
  /** Trailing income dividend per share (excludes cap-gain distributions). */
  dps: number;
  /** ~5y dividend-growth CAGR (decimal), or null if not enough history. */
  growth: number | null;
  /** Estimated annual capital-gains distribution per share — a multi-year average
   *  (0 for anything that doesn't distribute cap gains, e.g. stocks/most ETFs). */
  capGainDps: number;
}

interface YahooDivChart {
  chart?: {
    result?: Array<{ events?: { dividends?: Record<string, { amount?: number; date?: number }> } }>;
  };
}

const DAY = 86_400; // seconds
const UA = "Mozilla/5.0 (compatible; RetireTaxOptimizer/1.0)";

// ---- Yahoo crumb+cookie (needed only for the quote endpoint). Cached per warm
//      serverless instance; refreshed every 30 min. ----
let crumbCache: { crumb: string; cookie: string; at: number } | null = null;

async function getCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (crumbCache && Date.now() - crumbCache.at < 30 * 60 * 1000) return crumbCache;
  try {
    const seed = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    const cookie = seed
      .headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!cookie) return null;
    const cr = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
      signal: AbortSignal.timeout(8000),
    });
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.length > 40 || crumb.includes("<")) return null;
    crumbCache = { crumb, cookie, at: Date.now() };
    return crumbCache;
  } catch {
    return null;
  }
}

interface Quote {
  price: number;
  /** Income dividend yield as a PERCENT (e.g. 1.44 → 1.44%). Clean of cap gains. */
  dividendYield: number;
  quoteType: string;
}

/** Batched quote fetch → clean income yield + price + type per symbol. */
async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const auth = await getCrumb();
  if (!auth) return {};
  try {
    const url =
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}` +
      `&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as {
      quoteResponse?: { result?: Array<{ symbol?: string; regularMarketPrice?: number; dividendYield?: number; quoteType?: string }> };
    };
    const out: Record<string, Quote> = {};
    for (const q of body.quoteResponse?.result ?? []) {
      if (!q.symbol) continue;
      out[q.symbol.toUpperCase()] = {
        price: q.regularMarketPrice ?? 0,
        dividendYield: q.dividendYield ?? 0,
        quoteType: (q.quoteType ?? "").toUpperCase(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** All distribution events (chart) for one symbol — lumped income + cap gains. */
async function fetchDistributions(symbol: string): Promise<{ date: number; amount: number }[] | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=6y&interval=1mo&events=div`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as YahooDivChart;
    const events = body.chart?.result?.[0]?.events?.dividends;
    if (!events) return [];
    return Object.values(events)
      .map((e) => ({ date: e.date ?? 0, amount: e.amount ?? 0 }))
      .filter((d) => d.date > 0 && d.amount > 0)
      .sort((a, b) => a.date - b.date);
  } catch {
    return null;
  }
}

function computeOne(symbol: string, quote: Quote | undefined, divs: { date: number; amount: number }[] | null, nowSec: number): DivInfo {
  const sym = symbol.toUpperCase();
  // Trailing-12-month lump straight from the chart (income + any cap gains).
  const windowSum = (end: number) =>
    (divs ?? []).filter((d) => d.date > end - 365 * DAY && d.date <= end).reduce((s, d) => s + d.amount, 0);
  const trailingLump = windowSum(nowSec);

  // INCOME dividend: prefer the quote's clean yield (excludes cap-gain
  // distributions); fall back to the trailing lump when the quote is unavailable.
  const incomeFromYield = quote && quote.dividendYield > 0 && quote.price > 0 ? (quote.dividendYield / 100) * quote.price : 0;
  const dps = incomeFromYield > 0 ? Math.round(incomeFromYield * 1e4) / 1e4 : Math.round(trailingLump * 1e4) / 1e4;

  // CAP-GAIN distribution: average TOTAL annual distributions over the available
  // history, minus the income dividend. Averaging tames the year-to-year lumpiness
  // (a fund can distribute $8/share one year and $0 the next). Only counted when
  // total clearly exceeds income — so stocks/most ETFs land at 0, not on noise.
  let capGainDps = 0;
  if ((divs?.length ?? 0) > 0 && dps > 0) {
    const spanYears = Math.max(1, Math.min(5, Math.round(((nowSec - divs![0].date) / (365 * DAY)) || 1)));
    let total = 0;
    for (const d of divs!) if (d.date > nowSec - spanYears * 365 * DAY) total += d.amount;
    const avgAnnualTotal = total / spanYears;
    if (avgAnnualTotal > dps * 1.2) capGainDps = Math.round((avgAnnualTotal - dps) * 1e4) / 1e4;
  }

  // Dividend GROWTH: for individual stocks the chart events ARE dividends, so the
  // trailing-vs-5y-ago CAGR is meaningful. For funds the chart is contaminated by
  // cap-gain distributions, so we return null and let the model use a type default.
  let growth: number | null = null;
  const isStock = quote?.quoteType === "EQUITY";
  if (isStock && (divs?.length ?? 0) > 0) {
    const oldLump = windowSum(nowSec - 5 * 365 * DAY);
    if (trailingLump > 0 && oldLump > 0) {
      growth = Math.pow(trailingLump / oldLump, 1 / 5) - 1;
      growth = Math.max(-0.5, Math.min(0.5, growth));
      growth = Math.round(growth * 1000) / 1000;
    }
  }
  return { symbol: sym, dps, growth, capGainDps };
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  // Dividends change at most quarterly — cache hard (1 day), allow week-long stale.
  const headers = { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" };
  if (symbols.length === 0) return NextResponse.json({ dividends: {} }, { headers });

  const uniq = [...new Set(symbols)];
  // Server clock only used to define the trailing windows; not request-identifying.
  const nowSec = Math.floor(Date.now() / 1000);
  const [quotes, distLists] = await Promise.all([
    fetchQuotes(uniq),
    Promise.all(uniq.map((s) => fetchDistributions(s))),
  ]);

  const dividends: Record<string, DivInfo> = {};
  uniq.forEach((sym, i) => {
    const info = computeOne(sym, quotes[sym], distLists[i], nowSec);
    // Skip symbols we learned nothing about (no quote yield AND no chart data).
    if (info.dps > 0 || info.capGainDps > 0 || distLists[i] != null) dividends[sym] = info;
  });
  return NextResponse.json({ dividends }, { headers });
}
