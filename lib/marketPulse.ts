/**
 * Market pulse — a tiny, privacy-safe read of current market conditions, used to
 * frame the plan's standing advice in TODAY's market ("markets are down ~18% —
 * your Roth rollover moves more shares for the same tax").
 *
 * Data: the app's own /api/ticker/chart proxy for ONE broad index ETF (VTI,
 * total US market) — only that symbol is ever sent, consistent with the app's
 * privacy posture. Cached in localStorage for 6 hours.
 *
 * IMPORTANT FRAMING RULE: market-condition notices never change the PLAN's
 * dollar amounts — the engine already sized those. They explain why the same
 * move is more (or less) attractive right now, and they must never promise
 * timing ("markets can keep falling") — copy below is written to that bar.
 *
 * ⚠️ Educational estimates only — not investment advice.
 */

export interface MarketPulse {
  /** Proxy symbol the read is based on (broad US market ETF). */
  symbol: string;
  /** Date of the last close in the series (YYYY-MM-DD). */
  asOf: string;
  price: number;
  /** Highest close of the trailing year. */
  high52: number;
  /** price / high52 − 1 (0 = at the high; −0.2 = 20% below). */
  drawdownPct: number;
  /** Year-to-date simple return, when a first-of-year close exists. */
  ytdPct: number | null;
}

/** Pure computation from a close series (exported for testing). */
export function computePulse(
  symbol: string,
  closes: { date: string; close: number }[],
  livePrice: number | null,
): MarketPulse | null {
  if (closes.length < 30) return null; // too thin to describe a year
  const last = closes[closes.length - 1];
  const price = livePrice ?? last.close;
  const high52 = Math.max(...closes.map((c) => c.close), price);
  const year = last.date.slice(0, 4);
  const firstOfYear = closes.find((c) => c.date.slice(0, 4) === year);
  const ytdPct = firstOfYear ? price / firstOfYear.close - 1 : null;
  return {
    symbol,
    asOf: last.date,
    price,
    high52,
    drawdownPct: high52 > 0 ? price / high52 - 1 : 0,
    ytdPct,
  };
}

const PULSE_SYMBOL = "VTI";
const CACHE_KEY = "rto-market-pulse-v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

/** Client-side fetch with a 6h localStorage cache. Null on any failure — the UI
 *  simply shows nothing (market framing is a bonus, never a blocker). */
export async function fetchMarketPulse(): Promise<MarketPulse | null> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { t, data } = JSON.parse(cached) as { t: number; data: MarketPulse };
      if (Date.now() - t < CACHE_MS && data && data.symbol) return data;
    }
  } catch {
    /* ignore cache errors */
  }
  try {
    const res = await fetch(`/api/ticker/chart?symbols=${PULSE_SYMBOL}&range=1y`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      series?: Record<string, { price: number | null; closes: { date: string; close: number }[] }>;
    };
    const s = body.series?.[PULSE_SYMBOL];
    if (!s) return null;
    const pulse = computePulse(PULSE_SYMBOL, s.closes ?? [], s.price);
    if (pulse) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: pulse }));
      } catch {
        /* storage full/blocked — fine */
      }
    }
    return pulse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Condition-aware notices
// ---------------------------------------------------------------------------

export interface MarketNotice {
  icon: string;
  title: string;
  body: string;
  tone: "good" | "info" | "warn";
}

export interface NoticeContext {
  /** This year's planned Roth conversion (0 = none). */
  conversion: number;
  /** This year's planned savings draw (all buckets). */
  totalDraw: number;
  /** Cash/savings balance available (the cash-first tranche). */
  cashBalance: number;
  /** Guyton-Klinger dynamic spending enabled. */
  guardrails: boolean;
  /** The next dollar of long-term gains would be taxed at 0% this year. */
  gainsAtZero: boolean;
  /** Unrealized brokerage gain exists (something to harvest). */
  hasBrokerageGain: boolean;
  /** Any holding is currently priced below its cost (a harvestable loss). */
  hasLossHoldings: boolean;
}

const DOWN_MODERATE = -0.08;
const DOWN_DEEP = -0.15;
const NEAR_HIGH = -0.03;

/** Translate today's market into notices about the household's OWN plan.
 *  Ordered most-important-first; the UI may show the top few. */
export function marketNotices(pulse: MarketPulse, ctx: NoticeContext): MarketNotice[] {
  const out: MarketNotice[] = [];
  const dd = pulse.drawdownPct;
  const ddPct = Math.round(Math.abs(dd) * 100);

  if (dd <= DOWN_MODERATE && ctx.conversion > 0.5) {
    out.push({
      icon: "🔁",
      tone: "good",
      title: `Markets are ~${ddPct}% below their recent high — a good moment for your Roth rollover`,
      body:
        `Your conversion amount and its tax bill don't change, but the same dollars move MORE shares while prices are ` +
        `marked down — and when those shares recover, the growth happens inside the Roth, tax-free, with no future RMDs. ` +
        `(No one can time the bottom — markets can fall further — but a down market makes the rollover you already ` +
        `planned more valuable, not less.)`,
    });
  }
  if (dd <= DOWN_MODERATE && ctx.totalDraw > 0.5 && ctx.cashBalance > 0.5) {
    out.push({
      icon: "🛡️",
      tone: "info",
      title: "Down market: your withdrawals already sell cash first",
      body:
        `The plan drains cash/savings before touching investments, so this year's spending doesn't force you to sell ` +
        `holdings while they're ${ddPct}% below the high — that's the main defense against locking in losses early in ` +
        `retirement (sequence-of-returns risk).`,
    });
  }
  if (dd <= DOWN_MODERATE && ctx.hasLossHoldings) {
    out.push({
      icon: "🧾",
      tone: "info",
      title: "Some holdings are below what you paid — tax-loss harvesting may be worth a look",
      body:
        `Selling a losing position and immediately buying a similar (not identical) fund books a loss that can offset ` +
        `gains and up to $3,000 of ordinary income, without leaving the market. This planner doesn't model losses — ` +
        `worth checking your cost bases or asking your custodian.`,
    });
  }
  if (dd <= DOWN_MODERATE && ctx.guardrails) {
    out.push({
      icon: "📏",
      tone: "info",
      title: "Your guardrails are watching this",
      body:
        `You chose dynamic (Guyton-Klinger) spending: after a down year the plan may skip the inflation raise — a small, ` +
        `automatic belt-tightening that's already reflected in your forecast. Nothing to do now.`,
    });
  }
  if (dd >= NEAR_HIGH && ctx.gainsAtZero && ctx.hasBrokerageGain) {
    out.push({
      icon: "🌾",
      tone: "good",
      title: "Near the highs + your gains are taxed at 0% this year — a good year to harvest gains",
      body:
        `Your income leaves room in the 0% capital-gains band, and prices are near their 12-month high. Selling ` +
        `appreciated brokerage shares (and rebuying, if you want to stay invested) books the gain at 0% federal tax and ` +
        `resets your cost basis higher — shrinking the tax on every future sale.`,
    });
  }
  if (dd <= DOWN_DEEP) {
    out.push({
      icon: "🧭",
      tone: "warn",
      title: `A ${ddPct}% drawdown is exactly what the plan was stress-tested for`,
      body:
        `Your confidence number already includes markets like this one (and worse — 1931, 1974, 2008). The most ` +
        `expensive move in a deep drawdown is usually selling out entirely; the plan's answer is the withdrawal order ` +
        `and pace, not an exit.`,
    });
  }
  return out;
}
