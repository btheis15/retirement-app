/**
 * Main-thread client for the Monte-Carlo Web Worker (lib/mc.worker.ts). Components
 * call computeMonteCarlo(...) and get a Promise — the heavy simulation runs on a
 * separate thread, so the UI never blocks. A single worker is reused across calls,
 * each request matched to its response by id.
 *
 * Robust fallback: if Workers aren't available (SSR, or worker construction fails),
 * it computes synchronously on the main thread (the prior behavior) so nothing
 * breaks — just less smooth.
 */

import type { Household } from "./accounts";
import type { ProjectionAssumptions } from "./projection";
import type { ReturnModel } from "./returns";
import type { MonteCarloResult } from "./monteCarlo";
import { runMonteCarlo } from "./monteCarlo";
import { runHistoricalBootstrap } from "./returnsHistorical";
import { runRegimeSwitching } from "./returnsRegime";

export type MCKind = "mc" | "bootstrap" | "regime";

export interface MonteCarloRequest {
  kind: MCKind;
  household: Household;
  assumptions: ProjectionAssumptions;
  model: ReturnModel;
  runs: number;
  seed?: number;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: MonteCarloResult) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined" || workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./mc.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data as { id: number; result?: MonteCarloResult; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result as MonteCarloResult);
    };
    worker.onerror = () => {
      // Disable the worker and surface to callers; they'll fall back next time.
      workerBroken = true;
      worker = null;
      pending.forEach((p) => p.reject(new Error("Monte-Carlo worker crashed")));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function runOnMainThread(req: MonteCarloRequest): MonteCarloResult {
  const opts = { model: req.model, runs: req.runs, seed: req.seed };
  if (req.kind === "mc") return runMonteCarlo(req.household, req.assumptions, opts);
  if (req.kind === "bootstrap") return runHistoricalBootstrap(req.household, req.assumptions, opts);
  return runRegimeSwitching(req.household, req.assumptions, opts);
}

/** Run a Monte-Carlo job off the main thread (with a sync fallback). */
export function computeMonteCarlo(req: MonteCarloRequest): Promise<MonteCarloResult> {
  const w = getWorker();
  if (!w) {
    // No worker: compute synchronously, but defer a tick so any loading state paints.
    return new Promise((resolve) => setTimeout(() => resolve(runOnMainThread(req)), 0));
  }
  const id = nextId++;
  return new Promise<MonteCarloResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, ...req });
    } catch (err) {
      // postMessage can throw if an input isn't cloneable; fall back to main thread.
      pending.delete(id);
      try {
        resolve(runOnMainThread(req));
      } catch {
        reject(err);
      }
    }
  });
}
