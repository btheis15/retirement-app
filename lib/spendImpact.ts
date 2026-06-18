/**
 * Spend-impact sweep — the half of "how much should I spend?" that the ending-
 * value sweep (spendingSweep.ts) doesn't answer. For each spending level it reads
 * off THIS YEAR's tax-and-Medicare picture: the MAGI you'd file, your marginal
 * tax rate, and where you land on the IRMAA tiers — so the spend slider can show,
 * BEFORE you commit a number, which bracket and which Medicare cliff that number
 * puts you on, and offer "quick amounts" that sit just under each cliff.
 *
 * It runs the SINGLE-year planner (cheap — one year, not a full lifetime) across
 * spending levels, using the SAME withdrawal + conversion plan as the active year,
 * so the MAGI it reports is the real one the household would file (conversions and
 * RMDs included). MAGI is non-decreasing in spending, so the cliff crossings are
 * found by a simple scan + linear interpolation between grid points.
 *
 * ⚠️ Educational estimates only — IRMAA tiers are approximate awareness figures.
 */

import { Household } from "./accounts";
import { planYear, StrategyId, BracketTarget, ConversionParam } from "./optimizer";

export interface SpendImpactPoint {
  spend: number;
  /** This year's modified AGI — what the IRMAA tiers and brackets are read against. */
  magi: number;
  /** Highest ordinary tax bracket this spending reaches (e.g. 0.22). */
  marginalRate: number;
  /** Total tax (federal + state) this year at this spending level. */
  totalTax: number;
}

/** An IRMAA tier ceiling expressed in SPENDING terms: the yearly spend at which
 *  this household's MAGI crosses the tier top and the surcharge jumps. */
export interface IrmaaCliffMarker {
  /** Spend level where MAGI crosses the tier top (interpolated). */
  spend: number;
  /** The MAGI threshold being crossed. */
  threshold: number;
  /** Added household surcharge ($/yr) for stepping over this line. */
  jumpAnnual: number;
  /** Tier label you'd be in just ABOVE the line. */
  toLabel: string;
}

/** A marginal-rate step-up expressed in spending terms. */
export interface BracketMarker {
  spend: number;
  fromRate: number;
  toRate: number;
}

export interface SpendImpactConfig {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  year: number;
  conversion: ConversionParam;
  /** This year's inflation index (scales the nominal IRMAA tier tops). */
  inflationFactor?: number;
}

export interface SpendImpact {
  points: SpendImpactPoint[];
  max: number;
  /** Interpolated this-year picture at an arbitrary spend level. */
  at: (spend: number) => SpendImpactPoint;
  /** IRMAA tier tops that fall within (0, max], in ascending spend order. */
  irmaaCliffs: IrmaaCliffMarker[];
  /** Marginal-rate step-ups within (0, max], in ascending spend order. */
  bracketSteps: BracketMarker[];
}

type IrmaaTier = { upTo: number; monthlyPerPerson: number; label: string };

/** Linear-interpolate the spend at which a monotone series `value(p)` first reaches `target`. */
function crossingSpend(points: SpendImpactPoint[], value: (p: SpendImpactPoint) => number, target: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const lo = value(points[i - 1]);
    const hi = value(points[i]);
    if (lo < target && hi >= target) {
      const t = hi === lo ? 0 : (target - lo) / (hi - lo);
      return points[i - 1].spend + (points[i].spend - points[i - 1].spend) * t;
    }
  }
  return null;
}

export function spendImpact(
  household: Household,
  config: SpendImpactConfig,
  irmaaTiers: IrmaaTier[],
  medicareEnrollees: number,
  max = 400_000,
  steps = 40,
): SpendImpact {
  const factor = config.inflationFactor ?? 1;
  const points: SpendImpactPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const spend = Math.round((i / steps) * max);
    const yp = planYear(
      { ...household, annualSpending: spend },
      {
        strategy: config.strategy,
        bracketTarget: config.bracketTarget,
        year: config.year,
        conversion: config.conversion,
        inflationFactor: factor,
      },
    );
    points.push({
      spend,
      magi: yp.tax.magi,
      marginalRate: yp.tax.marginalOrdinaryRate,
      totalTax: yp.tax.totalTax,
    });
  }

  const step = max / steps;
  const at = (spend: number): SpendImpactPoint => {
    if (points.length === 0) return { spend, magi: 0, marginalRate: 0, totalTax: 0 };
    const clamped = Math.max(0, Math.min(spend, max));
    const lo = Math.min(points.length - 1, Math.floor(clamped / step));
    const hi = Math.min(points.length - 1, lo + 1);
    const a = points[lo];
    const b = points[hi];
    if (a === b || b.spend === a.spend) return a;
    const t = (clamped - a.spend) / (b.spend - a.spend);
    return {
      spend: clamped,
      magi: a.magi + (b.magi - a.magi) * t,
      // a marginal rate is a step, not a slope — report the level you're actually in
      marginalRate: t < 1 ? a.marginalRate : b.marginalRate,
      totalTax: a.totalTax + (b.totalTax - a.totalTax) * t,
    };
  };

  // IRMAA cliffs: each tier's top (scaled to this year) that MAGI crosses inside
  // the slider range, with the household $/yr jump for stepping over it.
  const irmaaCliffs: IrmaaCliffMarker[] = [];
  if (medicareEnrollees > 0) {
    for (let i = 0; i < irmaaTiers.length - 1; i++) {
      const threshold = irmaaTiers[i].upTo * factor;
      const s = crossingSpend(points, (p) => p.magi, threshold);
      if (s != null && s > 0 && s < max) {
        const jump = (irmaaTiers[i + 1].monthlyPerPerson - irmaaTiers[i].monthlyPerPerson) * 12 * medicareEnrollees;
        if (jump > 0) irmaaCliffs.push({ spend: s, threshold, jumpAnnual: jump, toLabel: irmaaTiers[i + 1].label });
      }
    }
  }

  // Marginal-rate step-ups, in spending terms.
  const bracketSteps: BracketMarker[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].marginalRate > points[i - 1].marginalRate + 1e-9) {
      bracketSteps.push({
        spend: points[i].spend,
        fromRate: points[i - 1].marginalRate,
        toRate: points[i].marginalRate,
      });
    }
  }

  return { points, max, at, irmaaCliffs, bracketSteps };
}
