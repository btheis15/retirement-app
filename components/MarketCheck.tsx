"use client";

/**
 * MarketCheck — today's market conditions, translated into what they mean for
 * THIS household's plan. Shown under the pace card on /plan (and the rollover
 * notice reappears on the walkthrough's rollconfirm step via useMarketPulse).
 *
 * Renders nothing until the pulse loads, and nothing at all if the market is
 * unremarkable AND no notice applies — silence is better than noise.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { fetchMarketPulse, marketNotices, MarketPulse, NoticeContext } from "@/lib/marketPulse";
import { percent } from "@/lib/format";

/** Load the cached/live market pulse once per mount. Null while loading/failed. */
export function useMarketPulse(): MarketPulse | null {
  const [pulse, setPulse] = useState<MarketPulse | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMarketPulse().then((p) => {
      if (alive && p) setPulse(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return pulse;
}

const TONE_BORDER: Record<string, string> = {
  good: "border-l-gain",
  info: "border-l-ss",
  warn: "border-l-deferred",
};

export function MarketCheck({ ctx }: { ctx: NoticeContext }) {
  const pulse = useMarketPulse();
  if (!pulse) return null;
  const notices = marketNotices(pulse, ctx);
  const dd = pulse.drawdownPct;
  const calm = dd > -0.08;
  // Unremarkable market and nothing plan-specific to say → stay quiet.
  if (calm && notices.length === 0) return null;

  return (
    <Card className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-bold">Market check</div>
        <div className="tabular text-[11px] text-foreground/45">
          US market {dd <= -0.005 ? `${percent(dd, 0)} vs 12-mo high` : "near its 12-mo high"}
          {pulse.ytdPct != null && <> · YTD {pulse.ytdPct >= 0 ? "+" : ""}{percent(pulse.ytdPct, 0)}</>}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {notices.slice(0, 3).map((n) => (
          <div key={n.title} className={`rounded-xl border border-border border-l-4 ${TONE_BORDER[n.tone]} bg-background/50 p-2.5`}>
            <div className="text-[13px] font-semibold leading-snug">
              <span aria-hidden className="mr-1">{n.icon}</span>
              {n.title}
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-foreground/65">{n.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-foreground/40">
        Based on a broad US-market index ({pulse.symbol}) as of {pulse.asOf}. Framing only — your plan&apos;s dollar
        amounts don&apos;t change with the market&apos;s mood, and none of this is a prediction.
      </p>
    </Card>
  );
}
