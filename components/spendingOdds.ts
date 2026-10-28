/**
 * Pure search for "how much can you safely spend?" — no React, no engine math.
 * `run(yearly)` must return the Monte-Carlo success fraction for that spending using
 * the SAME seed/paths every call (common random numbers), so levels are paired.
 */

export const ON_TRACK = 0.85; // same "On track" line as PlanHero
export const LADDER_FACTORS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;
const SCAN_FACTORS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6];

export interface OddsLevel {
  yearly: number;
  pct: number;
}

export interface SafeSpendResult {
  /** Highest VERIFIED spending (rounded down to $1,000) with odds >= 85%; null if none tested passes. */
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
    if (a >= base && p < ON_TRACK) break;
  }
  // Highest passing level below the lowest failing level.
  const tested = [...cache.entries()].sort((a, b) => a[0] - b[0]);
  const firstFail = tested.find(([, p]) => p < ON_TRACK);
  const passing = tested.filter(([, p]) => p >= ON_TRACK && (!firstFail || firstFail[0] > 0));
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
      if ((await test(mid)) >= ON_TRACK) lo = mid;
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
