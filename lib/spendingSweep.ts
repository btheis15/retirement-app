/**
 * Spending sweep — answers "how much CAN I spend?" by projecting the plan across
 * a range of yearly spending levels (once, cached) and reading off where the
 * money comfortably lasts, where it gets tight, and where it runs short — plus
 * the account value left at each level. Drives the colored slider zones and the
 * live impact readout on the guided plan's spending step.
 *
 * People (especially careful savers) chronically UNDER-spend because they can't
 * see the safe ceiling; this makes it concrete from their own accounts.
 *
 * The ceilings are computed on a DOWNSIDE (below-average) market path, not the
 * median — a plan that just barely lasts on the median path actually fails in
 * roughly half of real (volatile) markets, so calling that "sustainable" would
 * overstate safety. Running the sweep at a return haircut below the expected rate
 * lands the "comfortable" ceiling near a ~85–90% Monte-Carlo success level (spot-
 * checked against the MC engine), so the green zone reflects a genuinely cautious
 * spend rather than a coin-flip. The full MC confidence check still runs elsewhere.
 *
 * ⚠️ Educational estimates only.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";

/** How far below the expected return to run the "how much can I safely spend?"
 *  sweep, to approximate a poor-market (sequence-risk) path. Tuned so the
 *  no-shortfall ceiling sits near ~85–90% Monte-Carlo success for typical mixes. */
export const SWEEP_DOWNSIDE_HAIRCUT = 0.02;

export interface SweepPoint {
  spend: number;
  endingEstate: number; // gross account value left at the end ("overall value")
  depleted: boolean;
  depletionAge: number; // self age money runs short, or Infinity if it lasts
}

export interface SpendingSweep {
  points: SweepPoint[];
  max: number;
  /** Highest spend where the money still lasts to the plan's end age. */
  sustainableMax: number;
  /** Highest spend that also leaves a healthy cushion/estate. */
  comfortableMax: number;
  startingTotal: number;
  /** Interpolated outcome at an arbitrary spend level. */
  at: (spend: number) => SweepPoint;
}

export function spendingSweep(
  household: Household,
  assumptions: ProjectionAssumptions,
  max = 400_000,
  steps = 24,
): SpendingSweep {
  // Conversions don't change how much you can SPEND, and skipping them halves the
  // work, so sweep the base plan — on a DOWNSIDE return (haircut below expected) so
  // a "lasts" verdict means lasts even in a weak market, not just on the median path.
  const base: ProjectionAssumptions = {
    ...assumptions,
    convert: null,
    returnRate: Math.max(0, assumptions.returnRate - SWEEP_DOWNSIDE_HAIRCUT),
    returnFor: null,
  };
  const points: SweepPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const spend = Math.round((i / steps) * max);
    const proj = projectLifetime({ ...household, annualSpending: spend }, base);
    const shortRow = proj.rows.find((r) => r.shortfall);
    points.push({
      spend,
      endingEstate: proj.endingEstate,
      depleted: proj.depleted,
      depletionAge: shortRow ? shortRow.selfAge : Infinity,
    });
  }

  let sustainableMax = 0;
  for (const p of points) if (!p.depleted) sustainableMax = p.spend;

  // "Comfortable" = lasts AND ends with a real cushion (~5 years of that spend,
  // floored at $100k) so we don't call a barely-surviving plan comfortable.
  let comfortableMax = 0;
  for (const p of points) {
    if (!p.depleted && p.endingEstate >= Math.max(100_000, p.spend * 5)) comfortableMax = p.spend;
  }

  const startingTotal = household.accounts.reduce((s, a) => s + a.balance, 0);

  const at = (spend: number): SweepPoint => {
    if (points.length === 0) return { spend, endingEstate: 0, depleted: false, depletionAge: Infinity };
    const clamped = Math.max(0, Math.min(spend, max));
    const step = max / steps;
    const lo = Math.min(points.length - 1, Math.floor(clamped / step));
    const hi = Math.min(points.length - 1, lo + 1);
    const a = points[lo];
    const b = points[hi];
    if (a === b || b.spend === a.spend) return a;
    const t = (clamped - a.spend) / (b.spend - a.spend);
    return {
      spend: clamped,
      endingEstate: a.endingEstate + (b.endingEstate - a.endingEstate) * t,
      // depletion is a property of the higher-spend bracket (conservative)
      depleted: b.depleted,
      depletionAge: b.depleted ? b.depletionAge : Infinity,
    };
  };

  return { points, max, sustainableMax, comfortableMax, startingTotal, at };
}
