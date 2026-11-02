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

  // Bisect between lo and hi with real runs (verified, not interpolated) down to
  // $1,000 resolution, so the answer does not depend on where the scan started.
  if (lo != null && hi != null) {
    for (let i = 0; i < 12 && hi - lo > 1000; i++) {
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

// ---------------------------------------------------------------------------------------------
// "Keep your balance" — the highest spending at which a TYPICAL (median) market still ends the
// plan with as much money as you have today, in today's dollars. Same Monte Carlo, same seed, same
// paired paths as the safe search; only spending varies.
//
// Balance definition (verified against lib/projection.ts + lib/monteCarlo.ts): the engine's
// `endingEstate` is the GROSS sum of EVERY account balance at the end of the final plan year
// (pre-tax + Roth + taxable, and the cash account kind is bucketed with taxable, so cash IS
// included; nothing is tax-adjusted), which equals the last row's `endTotal`.
// `endingWealthReal` deflates each run's `endingEstate` by THAT run's own cumulative price level
// at the end of the final year, so its p50 is the real median of that same gross figure. (The
// last `bandReal` entry divides by the price level at the START of the final year, one year of
// inflation too light, so it overstates the real balance by ~one year of inflation; we therefore
// use endingWealthReal.) The comparison start is household.accounts summed the same way (all
// accounts, cash included, gross).
// ---------------------------------------------------------------------------------------------

/** What one simulated spending level showed. */
export interface LevelStat {
  /** Fraction of the 1,000 markets where the money lasts to the plan's end age. */
  pct: number;
  /** Median (p50) gross ending balance across the 1,000 markets, in today's dollars. */
  endReal: number;
}
export type LevelCache = Map<number, LevelStat>;

/** Pass the result to safeSpendFor/safeSpendWith as `onLevel` to share its levels with the keep search. */
export const recordLevels =
  (cache: LevelCache, also?: (yearly: number, r: MonteCarloResult) => void) =>
  (yearly: number, r: MonteCarloResult) => {
    cache.set(yearly, { pct: r.successPct, endReal: r.endingWealthReal.p50 });
    also?.(yearly, r);
  };

export const KEEP_SCAN_FACTORS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 2.0, 3.0, 4.0];

export interface KeepBalanceResult {
  /** Highest VERIFIED spending (a multiple of $1,000) whose median real ending balance is >= today's balance; null if none. */
  keep: number | null;
  /** True if even the top level tested kept the balance, so the real limit is higher. */
  atLeast: boolean;
  /** True if even the LOWEST level tested (`lowestTested`) did not keep the balance. */
  belowLowest: boolean;
  lowestTested: number;
  /** Today's total savings (all accounts, gross, cash included) the median ending balance is compared with. */
  start: number;
  /** Odds the money lasts to the end age at the keep level (null when keep is null). */
  successPct: number | null;
  /** Median real ending balance at the keep level (null when keep is null). */
  endReal: number | null;
  /** Every level simulated in this search or inherited from the safe search, ascending. */
  levels: (OddsLevel & { endReal: number })[];
}

export const startingTotal = (household: Household) => household.accounts.reduce((s, a) => s + a.balance, 0);

export async function findKeepBalance(
  base: number,
  start: number,
  run: (yearly: number) => Promise<LevelStat>,
  prior?: LevelCache,
  yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<KeepBalanceResult> {
  const cache: LevelCache = new Map(prior ?? []);
  const test = async (yearly: number) => {
    if (!cache.has(yearly)) {
      await yieldFn();
      cache.set(yearly, await run(yearly));
    }
    return cache.get(yearly)!;
  };
  const keeps = async (yearly: number) => (await test(yearly)).endReal >= start;
  const amounts = Array.from(new Set(KEEP_SCAN_FACTORS.map((f) => Math.max(1000, roundK(base * f))))).sort((a, b) => a - b);
  const lowestTested = amounts[0];

  // Binary-search the coarse grid (balance falls monotonically as spending rises), then bisect to $1,000.
  let lo: number | null = null; // highest passing
  let hi: number | null = null; // lowest failing above it
  if (!(await keeps(amounts[0]))) {
    hi = amounts[0];
  } else {
    lo = amounts[0];
    const top = amounts[amounts.length - 1];
    if (amounts.length > 1 && (await keeps(top))) {
      lo = top;
    } else {
      let a = 0;
      let b = amounts.length - 1; // amounts[a] passes, amounts[b] fails
      while (b - a > 1) {
        const m = Math.floor((a + b) / 2);
        if (await keeps(amounts[m])) a = m;
        else b = m;
      }
      lo = amounts[a];
      hi = amounts[b];
    }
  }
  if (lo != null && hi != null) {
    for (let i = 0; i < 12 && hi - lo > 1000; i++) {
      const mid = floorK((lo + hi) / 2);
      if (mid <= lo || mid >= hi) break;
      if (await keeps(mid)) lo = mid;
      else hi = mid;
    }
  }
  const levels = [...cache.entries()].sort((a, b) => a[0] - b[0]).map(([yearly, s]) => ({ yearly, pct: s.pct, endReal: s.endReal }));
  const at = lo != null ? cache.get(lo)! : null;
  return {
    keep: lo,
    atLeast: lo != null && hi == null,
    belowLowest: lo == null,
    lowestTested,
    start,
    successPct: at?.pct ?? null,
    endReal: at?.endReal ?? null,
    levels,
  };
}

/** Same run function, inputs, 1,000 runs and default seed as safeSpendWith. Pass the levels the safe
 *  search already ran (via recordLevels) as `prior` to skip re-simulating them. */
export async function keepBalanceWith(
  run: McRunner,
  household: Household,
  settings: PlannerSettings,
  prior?: LevelCache,
): Promise<KeepBalanceResult> {
  const assumptions = activeAssumptions(settings);
  const model = returnModel(household.accounts);
  return findKeepBalance(
    household.annualSpending,
    startingTotal(household),
    async (yearly) => {
      const r = await run({
        kind: "mc",
        household: { ...household, annualSpending: yearly },
        assumptions,
        model,
        runs: SAFE_SPEND_RUNS,
      });
      return { pct: r.successPct, endReal: r.endingWealthReal.p50 };
    },
    prior,
  );
}

export const keepBalanceFor = async (household: Household, settings: PlannerSettings, prior?: LevelCache) => {
  const { computeMonteCarlo } = await import("@/lib/mcClient");
  return keepBalanceWith(computeMonteCarlo as McRunner, household, settings, prior);
};
