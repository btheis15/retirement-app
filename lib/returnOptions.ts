/**
 * The ONE place the app's return-assumption choices are defined. Every surface
 * that shows or sets the deterministic return rate (walkthrough markets step,
 * Forecast assumptions, Spending Power copy) renders THESE options, so the
 * numbers can never disagree across screens.
 *
 * Four choices, all derived from the household's ACTUAL stock/bond/cash mix:
 *  - cautious    → a weak long run (returnModel's conservative bracket)
 *  - expected ★  → the forward-CMA compound rate for the mix (the suggested default)
 *  - strong      → a kind long run (optimistic bracket)
 *  - historical  → what the mix actually compounded at over 1928–2024
 *
 * A rate that matches none of them (older saves, hand-tuned values) is treated
 * as "custom" and is NEVER silently moved; a chosen card, by contrast, is a
 * standing choice that tracks the mix as holdings/prices change (reconciled in
 * one place: HouseholdProvider).
 */

import { ReturnModel } from "./returns";
import { historicalGeometric } from "./returnsHistorical";

export type ReturnChoice = "cautious" | "expected" | "strong" | "historical";

export interface ReturnOption {
  choice: ReturnChoice;
  label: string;
  /** Nominal compound %/yr for the household's current mix (0.1% steps). */
  rate: number;
  /** One plain-language line: what picking this card means. */
  blurb: string;
  /** The suggested default. */
  suggested?: boolean;
}

/** Two card rates within 0.25% count as the same choice (rm rates move a little
 *  day to day with prices; this keeps yesterday's pick matched to today's card). */
export const RETURN_MATCH_EPS = 0.0025;

export function resolveReturnRate(rm: ReturnModel, choice: ReturnChoice): number {
  switch (choice) {
    case "cautious":
      return rm.conservative;
    case "expected":
      return rm.expectedGeometric;
    case "strong":
      return rm.optimistic;
    case "historical":
      return historicalGeometric(rm);
  }
}

export function buildReturnOptions(rm: ReturnModel): ReturnOption[] {
  return [
    {
      choice: "cautious",
      label: "Cautious",
      rate: rm.conservative,
      blurb: "A weak long run for your mix — if the plan works here, it survives disappointing markets.",
    },
    {
      choice: "expected",
      label: "Expected",
      rate: rm.expectedGeometric,
      suggested: true,
      blurb: "What professional forward-looking estimates suggest your mix compounds at. ★ Suggested.",
    },
    {
      choice: "strong",
      label: "Strong",
      rate: rm.optimistic,
      blurb: "A kind long run for your mix — reasonable if markets do well, not a promise.",
    },
    {
      choice: "historical",
      label: "History repeated",
      rate: historicalGeometric(rm),
      blurb:
        "What your mix actually averaged over 1928–2024. Assumes the future repeats the past — many pros expect less at today's prices.",
    },
  ];
}

/** Which card (if any) a saved rate corresponds to. null → custom, leave it alone. */
export function matchReturnChoice(rm: ReturnModel, rate: number): ReturnChoice | null {
  let best: ReturnChoice | null = null;
  let bestDist = RETURN_MATCH_EPS;
  for (const o of buildReturnOptions(rm)) {
    const d = Math.abs(o.rate - rate);
    if (d < bestDist) {
      bestDist = d;
      best = o.choice;
    }
  }
  return best;
}

/** "72% stocks · 23% bonds · 5% cash" — the reason the numbers are what they are. */
export function describeMix(rm: ReturnModel): string {
  const p = (x: number) => `${Math.round(x * 100)}%`;
  return `${p(rm.equityPct)} stocks · ${p(rm.bondPct)} bonds · ${p(rm.cashPct)} cash`;
}
