/**
 * Web Worker that runs the heavy Monte-Carlo engines OFF the main thread, so the
 * UI stays at 60fps even while a ~1–4s simulation is crunching (notably on phones
 * like the iPhone 14). The engines are pure TypeScript with no DOM access, so they
 * run unchanged here; inputs/outputs are plain data (structured-cloneable).
 *
 * Protocol: the page posts { id, kind, household, assumptions, model, runs, seed };
 * we post back { id, result } or { id, error }. See lib/mcClient.ts for the
 * main-thread side (with a synchronous fallback if Workers are unavailable).
 */

import { runMonteCarlo } from "./monteCarlo";
import { runHistoricalBootstrap } from "./returnsHistorical";
import { runRegimeSwitching } from "./returnsRegime";
import { runPairedMonteCarlo } from "./compareMonteCarlo";
import { rankMostMoney } from "./recommendMonteCarlo";
import type { MonteCarloRequest, PairedRequest, MostMoneyRequest } from "./mcClient";

// `self` in a worker isn't a Window; cast to a minimal shape to avoid the DOM
// `postMessage(message, targetOrigin)` typing leaking in.
type IncomingMessage = (MonteCarloRequest | PairedRequest | MostMoneyRequest) & { id: number };
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<IncomingMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  try {
    const opts = { model: msg.model, runs: msg.runs, seed: msg.seed };
    const result =
      msg.kind === "paired"
        ? runPairedMonteCarlo(msg.household, msg.assumptionsA, msg.assumptionsB, opts)
        : msg.kind === "mostMoney"
          ? rankMostMoney(msg.household, msg.candidates, opts)
          : msg.kind === "mc"
            ? runMonteCarlo(msg.household, msg.assumptions, opts)
            : msg.kind === "bootstrap"
              ? runHistoricalBootstrap(msg.household, msg.assumptions, opts)
              : runRegimeSwitching(msg.household, msg.assumptions, opts);
    ctx.postMessage({ id: msg.id, result });
  } catch (err) {
    ctx.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
