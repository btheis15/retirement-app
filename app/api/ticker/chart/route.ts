// Yahoo Finance price history + latest price — proxy for holding valuation and
// the portfolio chart. Given ?symbols=AAPL,VTI&range=5y it returns, per symbol,
// the latest price, a display name, and a daily (or weekly for "max") close
// series.
//
// PRIVACY: only ticker SYMBOLS are sent here (and on to Yahoo) — never share
// counts, balances, ages, or identity. We do not log the request.
//
// Direct fetch to Yahoo's chart endpoint (not yahoo-finance2) for the same
// serverless-stability reason as the search route.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type YahooRange = "1mo" | "6mo" | "1y" | "5y" | "max";
const RANGES: Record<string, YahooRange> = { "1mo": "1mo", "6mo": "6mo", "1y": "1y", "5y": "5y", max: "max" };

interface Close {
  date: string;
  close: number;
}
interface SymbolSeries {
  symbol: string;
  name: string;
  price: number | null;
  closes: Close[];
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; longName?: string; shortName?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
    error?: unknown;
  };
}

function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

async function fetchOne(symbol: string, range: YahooRange): Promise<SymbolSeries | null> {
  const interval = range === "max" ? "1wk" : "1d";
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RetireTaxOptimizer/1.0)", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as YahooChart;
    const r = body.chart?.result?.[0];
    if (!r) return null;
    const ts = r.timestamp ?? [];
    const closeArr = r.indicators?.quote?.[0]?.close ?? [];
    const closes: Close[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closeArr[i];
      if (c == null || !Number.isFinite(c)) continue;
      closes.push({ date: fmtDate(ts[i]), close: Math.round(c * 100) / 100 });
    }
    const last = closes.length ? closes[closes.length - 1].close : null;
    const price = r.meta?.regularMarketPrice ?? last;
    const name = r.meta?.longName?.trim() || r.meta?.shortName?.trim() || symbol;
    return { symbol: symbol.toUpperCase(), name, price: price ?? null, closes };
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
  const range = RANGES[searchParams.get("range") ?? "5y"] ?? "5y";
  // Daily-ish freshness: serve from cache for 6h, allow stale for a day.
  const headers = { "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400" };
  if (symbols.length === 0) return NextResponse.json({ series: {} }, { headers });

  const results = await Promise.all([...new Set(symbols)].map((s) => fetchOne(s, range)));
  const series: Record<string, SymbolSeries> = {};
  for (const r of results) if (r) series[r.symbol] = r;
  return NextResponse.json({ series, range }, { headers });
}
