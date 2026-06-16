// Yahoo Finance ticker autocomplete — proxy for the "add a holding" search box.
// Returns stocks, ETFs, mutual funds, ADRs — anything Yahoo indexes — with
// symbol + display name + asset type + exchange so the UI can show a clean,
// pickable list.
//
// PRIVACY: only the user's typed query (a name/symbol) is sent here, then on to
// Yahoo. No balances, share counts, ages, or identity ever touch this route.
// We deliberately do NOT log the query.
//
// We hit Yahoo's autocomplete endpoint directly (not the yahoo-finance2 lib)
// because that lib bundles a strict response-schema validator that throws a 502
// inside a serverless function whenever Yahoo renames a field. The raw endpoint
// is stable; we parse only the shape we need.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SearchResult {
  symbol: string;
  name: string;
  type: string; // "EQUITY" | "ETF" | "MUTUALFUND" | "INDEX" | ...
  exchange: string | null;
}

interface YahooQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  exchDisp?: string;
}

const MAX_RESULTS = 12;
const SKIP_TYPES = new Set(["CURRENCY", "CRYPTOCURRENCY", "FUTURE"]);

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const headers = { "Cache-Control": "public, max-age=300, s-maxage=300" };
  if (q.length < 1) return NextResponse.json({ results: [] }, { headers });

  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?` +
    `q=${encodeURIComponent(q)}&quotesCount=${MAX_RESULTS}&newsCount=0&enableFuzzyQuery=true`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RetireTaxOptimizer/1.0)",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ results: [], error: `yahoo responded ${res.status}` }, { status: 502 });
    }
    const body = (await res.json()) as { quotes?: YahooQuote[] };
    const results: SearchResult[] = [];
    for (const r of body.quotes ?? []) {
      if (!r.symbol) continue;
      const type = (r.quoteType && r.quoteType.trim()) || "UNKNOWN";
      if (SKIP_TYPES.has(type)) continue;
      const name = (r.longname && r.longname.trim()) || (r.shortname && r.shortname.trim()) || String(r.symbol);
      const exchange = (r.exchDisp && r.exchDisp.trim()) || (r.exchange && r.exchange.trim()) || null;
      results.push({ symbol: String(r.symbol).toUpperCase(), name, type, exchange });
    }
    return NextResponse.json({ results }, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ results: [], error: msg }, { status: 502 });
  }
}
