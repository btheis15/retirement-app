/**
 * The ACTIVE plan, computed once — shared by the Plan tab and the quarterly
 * client report so every number either surface shows comes from the same
 * computation ("one number, one source").
 *
 *   assumptions  — the projection assumptions the user's settings imply
 *   activeProj   — the lifetime projection of the active plan
 *   plan         — this year, spending only (no conversion) — the funding table
 *   planConv     — this year WITH the active conversion — the to-do list, the
 *                  all-in tax, and the walkthrough finale all read this
 *   yearTaxTotal — this year's all-in tax (spending + conversion)
 *
 * Pure: no React. ⚠️ Educational estimates only — not tax advice.
 */

import { Household, bucketOf } from "./accounts";
import { PlannerSettings, survivorFromSettings } from "./defaults";
import { planYear, YearPlan } from "./optimizer";
import { projectLifetime, ProjectionAssumptions, ProjectionResult } from "./projection";
import { FilingStatus } from "./tax/constants";

/** A genuinely single household (sentinel spouse, birthYear ≤ 1900) files single. */
export function filingStatusOf(household: Household): FilingStatus {
  return household.spouse && household.spouse.birthYear > 1900 ? "mfj" : "single";
}

export function activeAssumptions(settings: PlannerSettings): ProjectionAssumptions {
  return {
    strategy: settings.strategy,
    bracketTarget: settings.bracketTarget,
    returnRate: settings.returnRate,
    inflationRate: settings.inflationRate,
    endAge: settings.endAge,
    convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
    survivor: survivorFromSettings(settings),
    heirTaxRate: settings.heirTaxRate,
    spendingStrategy: settings.spendingStrategy,
    dividendMode: settings.dividendMode,
  };
}

/** This year's plan. `futureRate` (from the active projection) sizes a
 *  recommended conversion; pass null for the spending-only plan. */
export function yearPlanFor(
  household: Household,
  settings: PlannerSettings,
  year: number,
  withConversion: { futureRate: number } | null,
): YearPlan {
  return planYear(household, {
    strategy: settings.strategy,
    bracketTarget: settings.bracketTarget,
    year,
    filingStatus: filingStatusOf(household),
    // A new retiree's ACTUAL premium this year comes from their old working
    // income (2-year lookback) — use it when they've told us.
    irmaaMagi: household.priorMagi?.twoYearsAgo || undefined,
    dividendMode: settings.dividendMode,
    conversion:
      withConversion && settings.useConversions
        ? settings.convertMode === "recommended"
          ? { mode: "recommended", futureRate: withConversion.futureRate }
          : { mode: "fillBracket", toBracket: settings.bracketTarget }
        : null,
  });
}

/** This year's all-in tax: the spending plan's tax plus the active
 *  conversion's (read off the projection's first row, which models it). */
export function yearTaxAllIn(plan: YearPlan, activeProj: ProjectionResult): number {
  const conversionTax = Math.max(0, (activeProj.rows[0]?.tax ?? plan.tax.totalTax) - plan.tax.totalTax);
  return plan.tax.totalTax + conversionTax;
}

/** What the conversion plan is worth: the ACTIVE projection vs. the same plan
 *  with conversions flipped (off when they're on, on when they're off). Null
 *  when there's no meaningful pre-tax balance or nothing would be converted. */
export interface ConversionImpact {
  pretaxShare: number;
  totalConverted: number;
  avgAnnualConversion: number;
  windowEndYear: number;
  windowYears: number;
  peakRmdBaseline: number;
  peakRmdWithConversions: number;
  peakRmdReduction: number;
  estateGain: number;
  lifetimeTaxDelta: number;
  recommended: boolean;
}
export function conversionImpact(
  household: Household,
  settings: PlannerSettings,
  activeProj: ProjectionResult,
): ConversionImpact | null {
  const pretax = household.accounts.filter((a) => bucketOf(a.kind) === "pretax").reduce((t, a) => t + a.balance, 0);
  const total = household.accounts.reduce((t, a) => t + a.balance, 0);
  const pretaxShare = total > 0 ? pretax / total : 0;
  if (pretaxShare < 0.25) return null;
  const base = activeAssumptions(settings);
  const flipped = projectLifetime(household, {
    ...base,
    convert: settings.useConversions ? null : { untilAge: settings.convertUntilAge, mode: settings.convertMode },
  });
  const withConv = settings.useConversions ? activeProj : flipped;
  const noConv = settings.useConversions ? flipped : activeProj;
  const convYears = withConv.rows.filter((r) => r.conversion > 0.5);
  if (withConv.totalConverted < 5_000) return null;
  return {
    pretaxShare,
    totalConverted: withConv.totalConverted,
    avgAnnualConversion: convYears.length ? withConv.totalConverted / convYears.length : 0,
    windowEndYear: convYears.length ? convYears[convYears.length - 1].year : 0,
    windowYears: convYears.length,
    peakRmdBaseline: noConv.peakRmd,
    peakRmdWithConversions: withConv.peakRmd,
    peakRmdReduction: Math.max(0, noConv.peakRmd - withConv.peakRmd),
    estateGain: withConv.endingEstateAfterTax - noConv.endingEstateAfterTax,
    lifetimeTaxDelta: withConv.lifetimeTax - noConv.lifetimeTax,
    recommended: withConv.endingEstateAfterTax - noConv.endingEstateAfterTax > 0,
  };
}

export interface PlanContext {
  year: number;
  filingStatus: FilingStatus;
  assumptions: ProjectionAssumptions;
  activeProj: ProjectionResult;
  plan: YearPlan;
  planConv: YearPlan;
  thisYearConversion: number;
  yearTaxTotal: number;
}

/** Everything above in one call (for non-React callers: the report, probes). */
export function buildPlanContext(household: Household, settings: PlannerSettings, year: number): PlanContext {
  const assumptions = activeAssumptions(settings);
  const activeProj = projectLifetime(household, assumptions);
  const plan = yearPlanFor(household, settings, year, null);
  const planConv = yearPlanFor(household, settings, year, { futureRate: activeProj.futureRate });
  return {
    year,
    filingStatus: filingStatusOf(household),
    assumptions,
    activeProj,
    plan,
    planConv,
    thisYearConversion: activeProj.rows[0]?.conversion ?? 0,
    yearTaxTotal: yearTaxAllIn(plan, activeProj),
  };
}
