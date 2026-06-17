/**
 * Roth-conversion ("rollover") analysis — the RMD tax-bomb defuser.
 *
 * Runs the chosen plan two ways — as-is, and with a multi-year pre-tax → Roth
 * conversion overlay through the low-tax window — and measures the difference:
 * how much the future forced RMDs shrink, how lifetime tax and after-tax wealth
 * move, and whether converting is actually worth it for THIS household.
 *
 * The headline most people feel is the RMD peak: a big untouched pre-tax balance
 * forces ever-larger withdrawals (all ordinary income) in your late 70s–80s.
 * Converting in your low-bracket years moves that money to Roth, where it grows
 * tax-free and is never force-withdrawn — so the future "bomb" gets smaller.
 *
 * ⚠️ Educational estimates only — not tax advice.
 */

import { Household, sumBuckets } from "./accounts";
import { BracketTarget, StrategyId } from "./optimizer";
import { projectLifetime, ProjectionResult } from "./projection";

export interface ConversionInputs {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  returnRate: number;
  inflationRate: number;
  endAge: number;
  convertUntilAge: number;
  /** "recommended" (rate-arbitrage, default) or "fillBracket". */
  mode?: "recommended" | "fillBracket";
  /** Survivor (widow's-penalty) assumption, or null to disable. */
  survivor?: { firstDeathAge: number; spendingFactor: number } | null;
}

export interface ConversionAnalysis {
  /** Worth doing for this household at the chosen goal/assumptions? */
  recommended: boolean;
  /** Share of investable assets currently in pre-tax (RMD-bearing) accounts. */
  pretaxShare: number;
  baseline: ProjectionResult; // same plan, NO conversions
  withConversions: ProjectionResult; // plan WITH the conversion overlay
  totalConverted: number;
  /** Average conversion in the years a conversion actually happens. */
  avgAnnualConversion: number;
  convertingYears: number;
  firstConversionYear: number | null;
  windowEndYear: number; // last year conversions run (self reaches convertUntilAge)
  convertUntilAge: number;
  bracketTarget: BracketTarget;
  // The two outcomes that decide whether it's worth it:
  estateGain: number; // after-tax wealth delta (+ = conversions leave more)
  lifetimeTaxDelta: number; // + = conversions pay more lifetime tax
  peakRmdBaseline: number;
  peakRmdWithConversions: number;
  peakRmdReduction: number;
}

/** Largest single-year RMD in a projection (already tracked on the result). */
function peakRmd(p: ProjectionResult): number {
  return p.peakRmd;
}

export function analyzeConversions(household: Household, inputs: ConversionInputs): ConversionAnalysis {
  const base = {
    strategy: inputs.strategy,
    bracketTarget: inputs.bracketTarget,
    returnRate: inputs.returnRate,
    inflationRate: inputs.inflationRate,
    endAge: inputs.endAge,
  };

  const survivor = inputs.survivor ?? null;
  const baseline = projectLifetime(household, { ...base, survivor });
  const withConversions = projectLifetime(household, {
    ...base,
    convert: { untilAge: inputs.convertUntilAge, mode: inputs.mode ?? "recommended" },
    survivor,
  });

  const buckets = sumBuckets(household.accounts);
  const pretaxShare = buckets.total > 0 ? buckets.pretax / buckets.total : 0;

  const convertingRows = withConversions.rows.filter((r) => r.conversion > 0);
  const convertingYears = convertingRows.length;
  const totalConverted = withConversions.totalConverted;
  const avgAnnualConversion = convertingYears > 0 ? totalConverted / convertingYears : 0;
  const firstConversionYear = convertingRows.length ? convertingRows[0].year : null;

  const windowEndYear = household.self.birthYear + inputs.convertUntilAge;

  const estateGain = withConversions.endingEstateAfterTax - baseline.endingEstateAfterTax;
  const lifetimeTaxDelta = withConversions.lifetimeTax - baseline.lifetimeTax;
  const peakRmdBaseline = peakRmd(baseline);
  const peakRmdWithConversions = peakRmd(withConversions);
  const peakRmdReduction = peakRmdBaseline - peakRmdWithConversions;

  // Recommend when there's a real pre-tax tax bomb AND converting either leaves
  // more after-tax money OR meaningfully shrinks the forced-RMD peak — without
  // pushing the plan into running short.
  const recommended =
    pretaxShare > 0.4 &&
    totalConverted > 10_000 &&
    !withConversions.depleted &&
    (estateGain > 1_000 || peakRmdReduction > 10_000);

  return {
    recommended,
    pretaxShare,
    baseline,
    withConversions,
    totalConverted,
    avgAnnualConversion,
    convertingYears,
    firstConversionYear,
    windowEndYear,
    convertUntilAge: inputs.convertUntilAge,
    bracketTarget: inputs.bracketTarget,
    estateGain,
    lifetimeTaxDelta,
    peakRmdBaseline,
    peakRmdWithConversions,
    peakRmdReduction,
  };
}

/** Sensible default conversion window end (self age): convert at least through
 *  the year RMDs begin. The caller can override with `convertUntilAge`. */
export function defaultConvertUntilAge(rmdStartAge: number): number {
  return Math.max(70, rmdStartAge);
}
