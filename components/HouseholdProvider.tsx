"use client";

/**
 * Client-side store for the household + planner settings, persisted per-device
 * in localStorage. There's no backend — everything you type stays in your
 * browser. You can flip between the built-in $5M example and your own numbers.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Account, Household } from "@/lib/accounts";
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
    }),
    [ready, mode, household, settings, setMode, updateHousehold, setAccounts, upsertAccount, removeAccount, updateSettings, resetOwn],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within HouseholdProvider");
  return ctx;
}
