/**
 * Sustainable-spending solver — answers the advisor question "how much can I
 * spend and still have an X% chance of never running short?" by bisecting on the
 * annual spend against the Monte-Carlo success rate (which falls monotonically as
 * spending rises). Reports the "plan-with" (~90%) and "best-guess" (~50%) levels
 * the way MoneyGuidePro/eMoney do.
 *
 * Runs async, yielding between bisection steps, so the UI stays responsive and can
 * show progress instead of freezing. A FIXED seed is shared across every
 * evaluation so success(spend) is a smooth, monotone function for the bisection.
 *
 * ⚠️ Educational estimates only.
 */

import { Household } from "./accounts";
import { ProjectionAssumptions } from "./projection";
import { runMonteCarlo } from "./monteCarlo";
import { ReturnModel } from "./returns";

export interface SafeSpendResult {
  /** Target success probability (e.g. 0.9). */
  target: number;
  /** Annual spend that hits that success level. */
  spend: number;
  /** Actual success at that spend (≈ target). */
  success: number;
}

export interface SolverOptions {
  model: ReturnModel;
  runs?: number;
  iterations?: number;
  seed?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function solveSafeSpending(
  household: Household,
  assumptions: ProjectionAssumptions,
  targets: number[],
  opts: SolverOptions,
): Promise<SafeSpendResult[]> {
  const runs = opts.runs ?? 120;
  const iterations = opts.iterations ?? 8;
  const seed = opts.seed ?? 4242; // shared across evals → monotone success(spend)
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const totalSteps = targets.length * (iterations + 1);
  let done = 0;

  const evalSpend = (spend: number): number =>
    runMonteCarlo({ ...household, annualSpending: spend }, assumptions, { model: opts.model, runs, seed }).successPct;

  const results: SafeSpendResult[] = [];
  for (const target of targets) {
    // Upper bracket: generous (15% withdrawal rate or 1.5× current spend) — at this
    // spend success is below any sane target; lower bracket 0 always succeeds.
    let lo = 0;
    let hi = Math.max(total * 0.15, household.annualSpending * 1.5, 1);
    for (let i = 0; i < iterations; i++) {
      await new Promise((r) => setTimeout(r, 0)); // yield to the event loop
      const mid = (lo + hi) / 2;
      const s = evalSpend(mid);
      if (s >= target) lo = mid;
      else hi = mid;
      opts.onProgress?.(++done, totalSteps);
    }
    await new Promise((r) => setTimeout(r, 0));
    const success = evalSpend(lo);
    opts.onProgress?.(++done, totalSteps);
    results.push({ target, spend: lo, success });
  }
  return results;
}
