"use client";

/**
 * Brokerage-style portfolio view: total value of all holdings over time, with a
 * range toggle and a "today" marker. Prices come from the daily cache.
 *
 * PRIVACY: builds the value series on-device from your share counts; only the
 * ticker symbols are ever looked up.
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, SectionTitle, Explainer } from "@/components/ui";
import { PriceLine } from "@/components/charts";
import { getSeries, portfolioSeries, PriceRange, SymbolSeries } from "@/lib/prices";
import { money, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";

const RANGES: { id: PriceRange; label: string }[] = [
  { id: "1mo", label: "1M" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "Max" },
];

export function PortfolioCard() {
  const { ready, mode, household } = useStore();

  const sharesBySymbol = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of household.accounts) {
      for (const h of a.holdings ?? []) {
        if (!h.ticker) continue;
        const sym = h.ticker.toUpperCase();
        m[sym] = (m[sym] ?? 0) + (h.shares || 0);
      }
    }
    return m;
  }, [household]);
  const tickers = useMemo(() => Object.keys(sharesBySymbol).sort(), [sharesBySymbol]);
  const tickerKey = tickers.join(",");

  const [range, setRange] = useState<PriceRange>("1y");
  const [series, setSeries] = useState<Record<string, SymbolSeries>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Live valuation applies to your OWN holdings; the demo stays a fixed
    // illustration (its share counts were calibrated to example prices).
    if (!ready || mode !== "own" || tickers.length === 0) {
      setSeries({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSeries(tickers, range)
      .then((s) => {
        if (!cancelled) setSeries(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, range, ready, mode]);

  const points = useMemo(() => portfolioSeries(sharesBySymbol, series), [sharesBySymbol, series]);

  if (mode !== "own" || tickers.length === 0) return null;

  const current = points.length ? points[points.length - 1].value : 0;
  const start = points.length ? points[0].value : 0;
  const change = current - start;
  const changePct = start > 0 ? change / start : 0;
  const up = change >= 0;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "";

  return (
    <>
      <SectionTitle>Your portfolio</SectionTitle>
      <Explainer>
        Live value of your holdings over time (prices refresh once a day). Only ticker symbols are looked up —
        your share counts and balances never leave the device.
      </Explainer>
      <Card>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-foreground/50">Current value</div>
            <div className="tabular text-2xl font-bold">{current > 0 ? money(current) : "—"}</div>
          </div>
          {points.length > 1 && (
            <div className={`text-right text-[13px] ${up ? "text-gain" : "text-tax"}`}>
              <div className="tabular font-semibold">
                {up ? "+" : ""}
                {money(change)}
              </div>
              <div className="text-[11px]">
                {up ? "+" : ""}
                {percent(changePct)} · past {rangeLabel}
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 -mx-1">
          {loading && points.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-foreground/45">Loading prices…</div>
          ) : (
            <PriceLine points={points} color={up ? HEX.gain : HEX.tax} />
          )}
        </div>
        <div className="mt-2 flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`press flex-1 rounded-lg py-1.5 text-[12px] font-medium ${
                range === r.id ? "bg-primary text-white" : "border border-border text-foreground/60"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}
