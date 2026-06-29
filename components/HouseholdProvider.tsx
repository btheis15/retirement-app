"use client";

/**
 * Client-side store for the household + planner settings, persisted per-device
 * in localStorage. There's no backend — everything you type stays in your
 * browser. You can flip between the built-in $5M example and your own numbers.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Account, Household, syncAccountFromHoldings } from "@/lib/accounts";
import { demoHousehold } from "@/lib/demo";
import { syncHouseholdDividends } from "@/lib/dividends";
import { emptyHousehold, DEFAULT_SETTINGS, PlannerSettings } from "@/lib/defaults";

type Mode = "demo" | "own";

interface Store {
  ready: boolean;
  mode: Mode;
  household: Household;
  settings: PlannerSettings;
  setMode: (m: Mode) => void;
  /** Re-roll the example to a fresh randomized household (different size, account
   *  mix, Social Security claim ages, spending). Switches into demo mode if needed.
   *  Deterministic per seed; the example then stays put until you re-roll again. */
  newExample: () => void;
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
  /** Apply fresh per-symbol dividend data (DPS + growth) to your own holdings,
   *  skipping any the user has hand-edited. Feeds the dividend-income model. */
  applyLiveDividends: (divBySymbol: Record<string, { dps: number; growth: number | null }>) => void;
  /** Replace your own data wholesale (used when importing a backup file). */
  loadOwn: (household: Household, settings?: Partial<PlannerSettings>) => void;
}

// Household fields that are "explore the example" levers: editing them in demo mode
// layers onto the example in place rather than forking into "your own numbers".
// (Entering real account balances goes through setAccounts/upsertAccount, which DO
// fork — that's the signal you're entering your actual money.)
const EXPLORATORY_KEYS = new Set<string>(["self", "spouse", "annualSpending", "retirementYear"]);

const KEY_MODE = "rto-mode";
const KEY_OWN = "rto-own-household";
const KEY_SETTINGS = "rto-settings";
const KEY_DEMO_SEED = "rto-demo-seed";

const Ctx = createContext<Store | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<Mode>("demo");
  const [ownHousehold, setOwnHousehold] = useState<Household>(() => emptyHousehold());
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_SETTINGS);
  // Some fields are *exploratory* levers on the example — birth years, the planned
  // retirement year, Social Security, and spending. Tweaking them should change the
  // example in place, NOT silently turn it into "your own numbers" (only entering
  // real account balances does that). Held as a patch layered over the example so
  // the demo stays the demo while you explore it. (null = the example as generated.)
  const [demoOverrides, setDemoOverrides] = useState<Partial<Household> | null>(null);
  // Which example to show: null = the classic fixed $5M example (the familiar
  // first-load picture); any number = a randomized example deterministic in that
  // seed. "New example" hands a fresh seed; it persists so the example stays put
  // across navigation/reload until you re-roll.
  const [demoSeed, setDemoSeed] = useState<number | null>(null);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const m = localStorage.getItem(KEY_MODE) as Mode | null;
      if (m === "own" || m === "demo") setModeState(m);
      const own = localStorage.getItem(KEY_OWN);
      if (own) setOwnHousehold(JSON.parse(own));
      const s = localStorage.getItem(KEY_SETTINGS);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
      const seed = localStorage.getItem(KEY_DEMO_SEED);
      if (seed != null) {
        const n = Number(seed);
        if (Number.isFinite(n) && n !== 0) setDemoSeed(n);
      }
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
    if (m === "demo") setDemoOverrides(null); // returning to the example shows it pristine
    try {
      localStorage.setItem(KEY_MODE, m);
    } catch {
      /* ignore */
    }
  }, []);

  // Re-roll the example. A fresh nonzero seed → a new randomized household; the
  // generator is deterministic in the seed, so the new example is reproducible and
  // stays put until the next re-roll. Math.random is fine here (browser UI event).
  const newExample = useCallback(() => {
    const seed = (Math.floor(Math.random() * 0x7fffffff) || 1) + 1; // nonzero
    setDemoSeed(seed);
    setDemoOverrides(null); // a new example starts from its own built-in values
    setModeState("demo");
    try {
      localStorage.setItem(KEY_DEMO_SEED, String(seed));
      localStorage.setItem(KEY_MODE, "demo");
    } catch {
      /* ignore */
    }
  }, []);

  // The demo household is read-only; editing while in demo mode silently forks
  // your edits into "own" mode so the example stays pristine. Memoized so it keeps
  // a STABLE reference across renders (demoHousehold() deep-copies on each call) —
  // otherwise every settings change would hand consumers a brand-new household
  // object and needlessly rerun the heavy engines (Monte Carlo, projections).
  const household = useMemo(() => {
    // Derive taxable dividend totals from per-holding data (when present) so the
    // tax engine and every view agree on the same per-share-based numbers.
    if (mode !== "demo") return syncHouseholdDividends(ownHousehold);
    const h = demoHousehold(demoSeed);
    return syncHouseholdDividends(demoOverrides ? { ...h, ...demoOverrides } : h);
  }, [mode, ownHousehold, demoOverrides, demoSeed]);

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
      // Adjusting only the exploratory levers (who you are, when you retire, Social
      // Security, spending) while exploring the example stays ON the example (no
      // fork) — these are "what if?" dials, not data entry. Entering real account
      // balances is what forks you into "your own numbers".
      const keys = Object.keys(patch);
      if (mode === "demo" && keys.length > 0 && keys.every((k) => EXPLORATORY_KEYS.has(k))) {
        setDemoOverrides((prev) => ({ ...(prev ?? {}), ...patch }));
        return;
      }
      const base = mode === "demo" ? { ...demoHousehold(demoSeed), ...(demoOverrides ?? {}) } : ownHousehold;
      editApply({ ...base, ...patch });
    },
    [mode, ownHousehold, demoOverrides, demoSeed, editApply],
  );

  const setAccounts = useCallback(
    (accounts: Account[]) => {
      const base = mode === "demo" ? demoHousehold(demoSeed) : ownHousehold;
      editApply({ ...base, accounts });
    },
    [mode, ownHousehold, demoSeed, editApply],
  );

  const upsertAccount = useCallback(
    (a: Account) => {
      const base = mode === "demo" ? demoHousehold(demoSeed) : ownHousehold;
      const exists = base.accounts.some((x) => x.id === a.id);
      const accounts = exists ? base.accounts.map((x) => (x.id === a.id ? a : x)) : [...base.accounts, a];
      editApply({ ...base, accounts });
    },
    [mode, ownHousehold, demoSeed, editApply],
  );

  const removeAccount = useCallback(
    (id: string) => {
      const base = mode === "demo" ? demoHousehold(demoSeed) : ownHousehold;
      editApply({ ...base, accounts: base.accounts.filter((x) => x.id !== id) });
    },
    [mode, ownHousehold, demoSeed, editApply],
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

  // Apply fresh per-symbol dividend data (DPS + growth) to your own holdings,
  // leaving any holding the user has hand-edited (dividendManual) untouched. Feeds
  // the per-holding dividend-income model in the engine.
  const applyLiveDividends = useCallback(
    (divBySymbol: Record<string, { dps: number; growth: number | null }>) => {
      if (mode !== "own") return; // never mutate the static demo
      setOwnHousehold((prev) => {
        let changed = false;
        const accounts = prev.accounts.map((a) => {
          if (!a.holdings || a.holdings.length === 0) return a;
          let accChanged = false;
          const holdings = a.holdings.map((h) => {
            if (h.dividendManual) return h; // user override wins
            const d = divBySymbol[h.ticker?.toUpperCase()];
            if (!d) return h;
            const nextGrowth = d.growth ?? h.dividendGrowthRate;
            if (Math.abs((h.dividendPerShare ?? -1) - d.dps) > 1e-6 || h.dividendGrowthRate !== nextGrowth) {
              accChanged = true;
              changed = true;
              return { ...h, dividendPerShare: d.dps, dividendGrowthRate: nextGrowth };
            }
            return h;
          });
          return accChanged ? { ...a, holdings } : a;
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
          // Treat an imported plan as the user's deliberate state: if the backup
          // doesn't say otherwise, mark it customized so the goal auto-apply
          // doesn't overwrite what they just restored.
          const next = { ...prev, ...s, planCustomized: s.planCustomized ?? true };
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
      newExample,
      updateHousehold,
      setAccounts,
      upsertAccount,
      removeAccount,
      updateSettings,
      resetOwn,
      applyLivePrices,
      applyLiveDividends,
      loadOwn,
    }),
    [ready, mode, household, settings, setMode, newExample, updateHousehold, setAccounts, upsertAccount, removeAccount, updateSettings, resetOwn, applyLivePrices, applyLiveDividends, loadOwn],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within HouseholdProvider");
  return ctx;
}
