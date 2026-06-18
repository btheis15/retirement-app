"use client";

/**
 * Loads daily price data for whatever tickers the household holds and feeds the
 * latest prices back into the store so balances (and the whole plan) reflect
 * live values. Fetches at most once per calendar day via lib/prices caching.
 *
 * PRIVACY: only ticker symbols leave the device (to /api/ticker/chart); share
 * counts and balances are computed here on-device and never sent.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { getSeries, getDividends, latestPrices, SymbolSeries } from "@/lib/prices";

interface PricesCtx {
  loading: boolean;
  series: Record<string, SymbolSeries>;
  latest: Record<string, number>;
  tickers: string[];
}

const Ctx = createContext<PricesCtx>({ loading: false, series: {}, latest: {}, tickers: [] });

export function PricesProvider({ children }: { children: React.ReactNode }) {
  const { household, ready, applyLivePrices, applyLiveDividends } = useStore();

  const tickers = useMemo(() => {
    const set = new Set<string>();
    for (const a of household.accounts) for (const h of a.holdings ?? []) if (h.ticker) set.add(h.ticker.toUpperCase());
    return [...set].sort();
  }, [household]);
  const tickerKey = tickers.join(",");

  const [series, setSeries] = useState<Record<string, SymbolSeries>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready || tickers.length === 0) {
      setSeries({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSeries(tickers, "5y")
      .then((s) => {
        if (cancelled) return;
        setSeries(s);
        applyLivePrices(latestPrices(s));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Dividend data (DPS + growth) — fetched alongside prices, applied to holdings
    // for the per-holding dividend model. Independent of the price load.
    getDividends(tickers).then((d) => {
      if (!cancelled) applyLiveDividends(d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, ready, applyLivePrices, applyLiveDividends]);

  const latest = useMemo(() => latestPrices(series), [series]);
  const value = useMemo<PricesCtx>(() => ({ loading, series, latest, tickers }), [loading, series, latest, tickers]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrices(): PricesCtx {
  return useContext(Ctx);
}
