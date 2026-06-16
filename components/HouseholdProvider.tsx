"use client";

/**
 * Client-side store for the household + planner settings, persisted per-device
 * in localStorage. There's no backend — everything you type stays in your
 * browser. You can flip between the built-in $5M example and your own numbers.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Account, Household, syncAccountFromHoldings } from "@/lib/accounts";
import { demoHousehold } from "@/lib/demo";
import { emptyHousehold, DEFAULT_SETTINGS, PlannerSettings } from "@/lib/defaults";

type Mode = "demo" | "own";

interface Store {
  ready: boolean;
  mode: Mode;
  household: Household;
  settings: PlannerSettings;
  setMode: (m: Mode) => void;
  updateHousehold: (patch: Partial<Household>) => void;
  setAccounts: (accounts: Account[]) => void;
  upsertAccount: (a: Account) => void;
  removeAccount: (id: string) => void;
  updateSettings: (patch: Partial<PlannerSettings>) => void;
  resetOwn: () => void;
  /** Apply fresh per-symbol prices to your own holdings (re-values balances).
   *  No-op in demo mode so the example stays fixed; only ticker symbols were
   *  ever sent to fetch these — never amounts. */
  applyLivePrices: (priceBySymbol: Record<string, number>) => void;
  /** Replace your own data wholesale (used when importing a backup file). */
  loadOwn: (household: Household, settings?: Partial<PlannerSettings>) => void;
}

const KEY_MODE = "rto-mode";
const KEY_OWN = "rto-own-household";
const KEY_SETTINGS = "rto-settings";

const Ctx = createContext<Store | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<Mode>("demo");
  const [ownHousehold, setOwnHousehold] = useState<Household>(() => emptyHousehold());
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_SETTINGS);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const m = localStorage.getItem(KEY_MODE) as Mode | null;
      if (m === "own" || m === "demo") setModeState(m);
      const own = localStorage.getItem(KEY_OWN);
      if (own) setOwnHousehold(JSON.parse(own));
      const s = localStorage.getItem(KEY_SETTINGS);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persistOwn = useCallback((h: Household) => {
    setOwnHousehold(h);
    try {
      localStorage.setItem(KEY_OWN, JSON.stringify(h));
    } catch {
      /* ignore */
    }
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(KEY_MODE, m);
    } catch {
      /* ignore */
    }
  }, []);

  // The demo household is read-only; editing while in demo mode silently forks
  // your edits into "own" mode so the example stays pristine.
  const household = mode === "demo" ? demoHousehold() : ownHousehold;

  const editApply = useCallback(
    (next: Household) => {
      if (mode === "demo") {
        setMode("own");
        persistOwn(next);
      } else {
        persistOwn(next);
      }
    },
    [mode, persistOwn, setMode],
  );

  const updateHousehold = useCallback(
    (patch: Partial<Household>) => {
      const base = mode === "demo" ? demoHousehold() : ownHousehold;
      editApply({ ...base, ...patch });
    },
    [mode, ownHousehold, editApply],
  );

  const setAccounts = useCallback(
    (accounts: Account[]) => {
      const base = mode === "demo" ? demoHousehold() : ownHousehold;
      editApply({ ...base, accounts });
    },
    [mode, ownHousehold, editApply],
  );

  const upsertAccount = useCallback(
    (a: Account) => {
      const base = mode === "demo" ? demoHousehold() : ownHousehold;
      const exists = base.accounts.some((x) => x.id === a.id);
      const accounts = exists ? base.accounts.map((x) => (x.id === a.id ? a : x)) : [...base.accounts, a];
      editApply({ ...base, accounts });
    },
    [mode, ownHousehold, editApply],
  );

  const removeAccount = useCallback(
    (id: string) => {
      const base = mode === "demo" ? demoHousehold() : ownHousehold;
      editApply({ ...base, accounts: base.accounts.filter((x) => x.id !== id) });
    },
    [mode, ownHousehold, editApply],
  );

  const updateSettings = useCallback((patch: Partial<PlannerSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetOwn = useCallback(() => {
    persistOwn(emptyHousehold());
  }, [persistOwn]);

  const applyLivePrices = useCallback(
    (prices: Record<string, number>) => {
      if (mode !== "own") return; // never mutate the static demo
      setOwnHousehold((prev) => {
        let changed = false;
        const accounts = prev.accounts.map((a) => {
          if (!a.holdings || a.holdings.length === 0) return a;
          let accChanged = false;
          const holdings = a.holdings.map((h) => {
            const p = prices[h.ticker?.toUpperCase()];
            if (p != null && p > 0 && Math.abs((h.price ?? 0) - p) > 1e-6) {
              accChanged = true;
              changed = true;
              return { ...h, price: p };
            }
            return h;
          });
          return accChanged ? syncAccountFromHoldings({ ...a, holdings }) : a;
        });
        if (!changed) return prev;
        const next = { ...prev, accounts };
        try {
          localStorage.setItem(KEY_OWN, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [mode],
  );

  const loadOwn = useCallback(
    (h: Household, s?: Partial<PlannerSettings>) => {
      setMode("own");
      persistOwn(h);
      if (s) {
        setSettings((prev) => {
          const next = { ...prev, ...s };
          try {
            localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    },
    [setMode, persistOwn],
  );

  const value = useMemo<Store>(
    () => ({
      ready,
      mode,
      household,
      settings,
      setMode,
      updateHousehold,
      setAccounts,
      upsertAccount,
      removeAccount,
      updateSettings,
      resetOwn,
      applyLivePrices,
      loadOwn,
    }),
    [ready, mode, household, settings, setMode, updateHousehold, setAccounts, upsertAccount, removeAccount, updateSettings, resetOwn, applyLivePrices, loadOwn],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within HouseholdProvider");
  return ctx;
}
