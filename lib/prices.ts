/**
 * Client-side price layer. Talks to /api/ticker/* (which proxy Yahoo Finance),
 * caches results in localStorage for the rest of the calendar day, and builds a
 * portfolio-value-over-time series from the user's holdings.
 *
 * PRIVACY: only ticker symbols (and the search box's text) ever go over the
 * wire. Share counts, balances, cost basis, ages, and spending stay on-device.
 */

export interface SearchResult {
  symbol: string;
  name: string;
  type: string; // EQUITY | ETF | MUTUALFUND | INDEX | ...
  exchange: string | null;
}

export interface SymbolSeries {
  symbol: string;
  name: string;
  price: number | null;
  closes: { date: string; close: number }[];
}

export type PriceRange = "1mo" | "1y" | "5y" | "max";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Plain-English label for Yahoo's asset-type codes. */
export function assetTypeLabel(type: string): string {
  switch (type.toUpperCase()) {
    case "EQUITY":
      return "Stock";
    case "ETF":
      return "ETF";
    case "MUTUALFUND":
      return "Mutual fund";
    case "INDEX":
      return "Index";
    case "CURRENCY":
      return "Currency";
    default:
      return type;
  }
}

/** Live ticker search (debounce in the caller). Returns [] on any failure. */
export async function searchTickers(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await fetch(`/api/ticker/search?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: SearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

interface ChartCache {
  fetchedOn: string;
  series: Record<string, SymbolSeries>;
}

const cacheKey = (range: PriceRange) => `rto-prices-${range}`;

function readCache(range: PriceRange): ChartCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(range));
    if (!raw) return null;
    return JSON.parse(raw) as ChartCache;
  } catch {
    return null;
  }
}

function writeCache(range: PriceRange, cache: ChartCache) {
  try {
    localStorage.setItem(cacheKey(range), JSON.stringify(cache));
  } catch {
    /* quota / private mode — ignore, we just refetch next time */
  }
}

/** The API routes cap each request at 40 symbols — a bigger household (or a
 *  CSV import) must be fetched in chunks or symbols past #40 silently never
 *  price. Exported for the probe. */
export const SYMBOL_CHUNK = 40;
export function chunkSymbols(symbols: string[], size = SYMBOL_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < symbols.length; i += size) out.push(symbols.slice(i, i + size));
  return out;
}

/** Fetch price series for symbols at a range, reusing today's cache when it
 *  already covers every requested symbol. Refetches at most once per calendar
 *  day (per the "daily refresh is fine" requirement). */
export async function getSeries(symbols: string[], range: PriceRange = "5y"): Promise<Record<string, SymbolSeries>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return {};

  const cached = readCache(range);
  const fresh = cached?.fetchedOn === todayKey() ? cached.series : {};
  const missing = wanted.filter((s) => !fresh[s]);

  if (missing.length === 0) {
    const out: Record<string, SymbolSeries> = {};
    for (const s of wanted) out[s] = fresh[s];
    return out;
  }

  try {
    // Chunked: the route slices at 40 symbols per request.
    const results = await Promise.all(
      chunkSymbols(missing).map(async (chunk) => {
        const res = await fetch(`/api/ticker/chart?symbols=${encodeURIComponent(chunk.join(","))}&range=${range}`);
        if (!res.ok) return {};
        const data = (await res.json()) as { series?: Record<string, SymbolSeries> };
        return data.series ?? {};
      }),
    );
    const merged = Object.assign({ ...fresh }, ...results) as Record<string, SymbolSeries>;
    if (Object.keys(merged).length > Object.keys(fresh).length) {
      writeCache(range, { fetchedOn: todayKey(), series: merged });
      const out: Record<string, SymbolSeries> = {};
      for (const s of wanted) if (merged[s]) out[s] = merged[s];
      return out;
    }
  } catch {
    /* fall through to whatever we have cached */
  }
  const out: Record<string, SymbolSeries> = {};
  for (const s of wanted) if (fresh[s]) out[s] = fresh[s];
  return out;
}

export interface DivInfo {
  /** Trailing-12-month dividend per share. */
  dps: number;
  /** ~5y dividend-growth CAGR (decimal), or null if not enough history. */
  growth: number | null;
}

interface DivCache {
  fetchedOn: string;
  dividends: Record<string, DivInfo>;
}

const DIV_KEY = "rto-dividends";

/** Fetch per-symbol dividend-per-share + growth, daily-cached like prices. */
export async function getDividends(symbols: string[]): Promise<Record<string, DivInfo>> {
  const wanted = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return {};
  let cached: DivCache | null = null;
  try {
    const raw = localStorage.getItem(DIV_KEY);
    if (raw) cached = JSON.parse(raw) as DivCache;
  } catch {
    /* ignore */
  }
  const fresh = cached?.fetchedOn === todayKey() ? cached.dividends : {};
  const missing = wanted.filter((s) => !fresh[s]);
  if (missing.length === 0) {
    const out: Record<string, DivInfo> = {};
    for (const s of wanted) out[s] = fresh[s];
    return out;
  }
  try {
    const results = await Promise.all(
      chunkSymbols(missing).map(async (chunk) => {
        const res = await fetch(`/api/ticker/dividends?symbols=${encodeURIComponent(chunk.join(","))}`);
        if (!res.ok) return {};
        const data = (await res.json()) as { dividends?: Record<string, DivInfo> };
        return data.dividends ?? {};
      }),
    );
    {
      const merged = Object.assign({ ...fresh }, ...results) as Record<string, DivInfo>;
      try {
        localStorage.setItem(DIV_KEY, JSON.stringify({ fetchedOn: todayKey(), dividends: merged }));
      } catch {
        /* quota — refetch next time */
      }
      const out: Record<string, DivInfo> = {};
      for (const s of wanted) if (merged[s]) out[s] = merged[s];
      return out;
    }
  } catch {
    /* fall through to cache */
  }
  const out: Record<string, DivInfo> = {};
  for (const s of wanted) if (fresh[s]) out[s] = fresh[s];
  return out;
}

/** Map of symbol → latest price, for valuing holdings. */
export function latestPrices(series: Record<string, SymbolSeries>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sym, s] of Object.entries(series)) {
    if (s.price != null) out[sym] = s.price;
    else if (s.closes.length) out[sym] = s.closes[s.closes.length - 1].close;
  }
  return out;
}

export interface PortfolioPoint {
  date: string;
  value: number;
}

/**
 * Build portfolio value over time: for the union of trading dates across all
 * held tickers, value(date) = Σ shares_i × (most recent close ≤ date)_i. A
 * forward-fill so a ticker with sparser data doesn't punch holes in the line.
 * `sharesBySymbol` is read on-device only.
 */
export function portfolioSeries(
  sharesBySymbol: Record<string, number>,
  series: Record<string, SymbolSeries>,
): PortfolioPoint[] {
  const symbols = Object.keys(sharesBySymbol).filter((s) => series[s]?.closes.length);
  if (symbols.length === 0) return [];

  const dateSet = new Set<string>();
  for (const s of symbols) for (const c of series[s].closes) dateSet.add(c.date);
  const dates = [...dateSet].sort();

  // Per-symbol cursor for forward-fill.
  const idx: Record<string, number> = {};
  const lastClose: Record<string, number> = {};
  for (const s of symbols) idx[s] = 0;

  const points: PortfolioPoint[] = [];
  for (const date of dates) {
    let value = 0;
    let anyData = false;
    for (const s of symbols) {
      const closes = series[s].closes;
      while (idx[s] < closes.length && closes[idx[s]].date <= date) {
        lastClose[s] = closes[idx[s]].close;
        idx[s]++;
      }
      if (lastClose[s] != null) {
        value += sharesBySymbol[s] * lastClose[s];
        anyData = true;
      }
    }
    if (anyData) points.push({ date, value });
  }
  return points;
}
