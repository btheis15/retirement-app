/**
 * Pure search for "how much can you safely spend?" — no React, no engine math.
 * `run(yearly)` must return the Monte-Carlo success fraction for that spending using
 * the SAME seed/paths every call (common random numbers), so levels are paired.
 */

import type { Household } from "@/lib/accounts";
import type { ProjectionAssumptions } from "@/lib/projection";
import type { ReturnModel } from "@/lib/returns";
import { returnModel } from "@/lib/returns";
import type { MonteCarloResult } from "@/lib/monteCarlo";
import type { PlannerSettings } from "@/lib/defaults";
import { activeAssumptions } from "@/lib/planContext";

const SAFE_SPEND_RUNS = 1000;

export const ON_TRACK = 0.85; // PlanHero's "On track" status line (labels only)
/** The ONE app-wide definition of "safe to spend": 90% Monte-Carlo success — the same
 *  bar the Forecast tab's safe-spending range uses (lib/spendingSolver, [0.9]) and the
 *  "plan-with" convention of MoneyGuidePro/eMoney. */
export const SAFE_LINE = 0.9;
export const LADDER_FACTORS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;
const SCAN_FACTORS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6];

export interface OddsLevel {
  yearly: number;
  pct: number;
}

export interface SafeSpendResult {
  /** Highest VERIFIED spending (rounded down to $1,000) with odds >= 90% (SAFE_LINE); null if none tested passes. */
  safe: number | null;
  /** True if even the top level tested (1.6x) passed, so the real limit is higher. */
  atLeast: boolean;
  /** Every level actually simulated, ascending by spending. */
  levels: OddsLevel[];
}

export const ladderAmounts = (base: number) =>
  LADDER_FACTORS.map((f) => (f === 1 ? base : Math.max(1000, Math.round((base * f) / 1000) * 1000)));

const roundK = (n: number) => Math.round(n / 1000) * 1000;
const floorK = (n: number) => Math.floor(n / 1000) * 1000;

export async function findSafeSpend(
  base: number,
  run: (yearly: number) => Promise<number>,
  yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<SafeSpendResult> {
  const cache = new Map<number, number>();
  const test = async (yearly: number) => {
    if (!cache.has(yearly)) {
      await yieldFn();
      cache.set(yearly, await run(yearly));
    }
    return cache.get(yearly)!;
  };
  const amounts = Array.from(
    new Set(SCAN_FACTORS.map((f) => (f === 1 ? base : Math.max(1000, roundK(base * f))))),
  ).sort((a, b) => a - b);

  let lo: number | null;
  let hi: number | null;
  // Scan ascending, stopping once we are past the current plan and a level fails.
  for (const a of amounts) {
    const p = await test(a);
    if (a >= base && p < SAFE_LINE) break;
  }
  // Highest passing level below the lowest failing level.
  const tested = [...cache.entries()].sort((a, b) => a[0] - b[0]);
  const firstFail = tested.find(([, p]) => p < SAFE_LINE);
  const passing = tested.filter(([, p]) => p >= SAFE_LINE && (!firstFail || firstFail[0] > 0));
  // Monotone assumption: spending up => odds down. Passing levels are those below the first failure
  // among ascending levels; any "pass" above a fail is noise and ignored.
  const valid = firstFail ? passing.filter(([a]) => a < firstFail[0]) : passing;
  lo = valid.length ? valid[valid.length - 1][0] : null;
  hi = firstFail ? firstFail[0] : null;

  // Bisect between lo and hi with real runs (verified, not interpolated).
  if (lo != null && hi != null) {
    for (let i = 0; i < 4 && hi - lo > 1000; i++) {
      const mid = floorK((lo + hi) / 2);
      if (mid <= lo || mid >= hi) break;
      if ((await test(mid)) >= SAFE_LINE) lo = mid;
      else hi = mid;
    }
  }
  for (const a of ladderAmounts(base)) await test(a); // the visible ladder is always fully simulated
  const levels = [...cache.entries()].sort((a, b) => a[0] - b[0]).map(([yearly, pct]) => ({ yearly, pct }));
  return {
    safe: lo != null ? (lo === base ? base : floorK(lo)) : null,
    atLeast: hi == null && lo != null,
    levels,
  };
}

type McRunner = (req: {
  kind: "mc";
  household: Household;
  assumptions: ProjectionAssumptions;
  model: ReturnModel;
  runs: number;
}) => Promise<MonteCarloResult>;

/** The ONE shared "safe to spend" computation used by the Plan tab, the walkthrough's spend step and
 *  the report: assumptions = activeAssumptions(settings), model = returnModel(accounts), 1,000 runs,
 *  default seed, paired levels. `run` is injectable so Node probes can call runMonteCarlo directly.
 *  `onLevel` lets a caller capture the full result at a level (e.g. the plan's current spending). */
export async function safeSpendWith(
  run: McRunner,
  household: Household,
  settings: PlannerSettings,
  onLevel?: (yearly: number, r: MonteCarloResult) => void,
): Promise<SafeSpendResult> {
  const assumptions = activeAssumptions(settings);
  const model = returnModel(household.accounts);
  return findSafeSpend(household.annualSpending, async (yearly) => {
    const r = await run({
      kind: "mc",
      household: { ...household, annualSpending: yearly },
      assumptions,
      model,
      runs: SAFE_SPEND_RUNS,
    });
    onLevel?.(yearly, r);
    return r.successPct;
  });
}

export const safeSpendFor = async (
  household: Household,
  settings: PlannerSettings,
  onLevel?: (yearly: number, r: MonteCarloResult) => void,
) => {
  // Lazy so Node probes can import this module without the worker client.
  const { computeMonteCarlo } = await import("@/lib/mcClient");
  return safeSpendWith(computeMonteCarlo as McRunner, household, settings, onLevel);
};
