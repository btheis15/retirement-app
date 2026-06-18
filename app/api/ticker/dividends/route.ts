// Yahoo Finance dividend history → per-symbol trailing dividend-per-share (DPS)
// and recent annual dividend-growth rate. Given ?symbols=AAPL,VTI it returns,
// per symbol, the trailing-12-month DPS and a ~5-year dividend-growth CAGR, used
// to seed the per-holding dividend model (the user can override either).
//
// PRIVACY: only ticker SYMBOLS are sent here (and on to Yahoo) — never share
// counts, balances, ages, or identity. We do not log the request.
//
// Direct fetch to Yahoo's chart endpoint with dividend events, matching the
// price-chart route's serverless-stability approach.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DivInfo {
  symbol: string;
  /** Trailing-12-month dividend per share. */
  dps: number;
  /** ~5y dividend-growth CAGR (decimal), or null if not enough history. */
  growth: number | null;
}

interface YahooDivChart {
  chart?: {
    result?: Array<{ events?: { dividends?: Record<string, { amount?: number; date?: number }> } }>;
  };
}

const DAY = 86_400; // seconds

async function fetchOne(symbol: string, nowSec: number): Promise<DivInfo | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=6y&interval=1mo&events=div`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RetireTaxOptimizer/1.0)", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as YahooDivChart;
    const events = body.chart?.result?.[0]?.events?.dividends;
    if (!events) return { symbol: symbol.toUpperCase(), dps: 0, growth: null }; // pays no dividend
    const divs = Object.values(events)
      .map((e) => ({ date: e.date ?? 0, amount: e.amount ?? 0 }))
      .filter((d) => d.date > 0 && d.amount > 0)
      .sort((a, b) => a.date - b.date);
    if (divs.length === 0) return { symbol: symbol.toUpperCase(), dps: 0, growth: null };

    // Sum of dividends paid within a trailing 12-month window ending `end`.
    const windowSum = (end: number) => divs.filter((d) => d.date > end - 365 * DAY && d.date <= end).reduce((s, d) => s + d.amount, 0);
    const dps = windowSum(nowSec);
    const oldDps = windowSum(nowSec - 5 * 365 * DAY); // the 12mo ending ~5y ago
    let growth: number | null = null;
    if (dps > 0 && oldDps > 0) {
      growth = Math.pow(dps / oldDps, 1 / 5) - 1;
      growth = Math.max(-0.5, Math.min(0.5, growth)); // sanity clamp
      growth = Math.round(growth * 1000) / 1000;
    }
    return { symbol: symbol.toUpperCase(), dps: Math.round(dps * 1e4) / 1e4, growth };
  } catch {
    return null;
  }
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

  // Server clock only used to define the trailing-12-month window; not request-identifying.
  const nowSec = Math.floor(Date.now() / 1000);
  const results = await Promise.all([...new Set(symbols)].map((s) => fetchOne(s, nowSec)));
  const dividends: Record<string, DivInfo> = {};
  for (const r of results) if (r) dividends[r.symbol] = r;
  return NextResponse.json({ dividends }, { headers });
}
