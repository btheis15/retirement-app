import { Household, defaultRetirementYear } from "./accounts";
import { BracketTarget, StrategyId } from "./optimizer";
import type { Sex } from "./mortality";
import type { ReturnChoice } from "./returnOptions";

/**
 * What the user is optimizing FOR. The robo-advisor turns a goal into a concrete
 * plan (strategy + bracket + whether to do Roth conversions) by simulating the
 * candidates and picking the winner for that objective. See lib/goals.ts.
 */
export type GoalId = "maxCapital" | "lowestTax" | "lowestRate";

/** A blank household for "enter my own numbers" mode. */
export function emptyHousehold(): Household {
  const thisYear = new Date().getFullYear();
  return {
    self: { label: "You", birthYear: thisYear - 63, socialSecurityAnnual: 0, ssClaimAge: 67 },
    spouse: { label: "Spouse", birthYear: thisYear - 61, socialSecurityAnnual: 0, ssClaimAge: 67 },
    pensionAnnual: 0,
    annualSpending: 120_000,
    brokerageDividendsAnnual: 0,
    state: "IL",
    retirementYear: defaultRetirementYear(thisYear - 63),
    accounts: [],
  };
}

export interface PlannerSettings {
  /** The objective the robo-advisor optimizes for. */
  goal: GoalId;
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  returnRate: number;
  /** Which mix-derived return card the rate came from (lib/returnOptions.ts).
   *  When set, HouseholdProvider keeps returnRate tracking the household's
   *  actual mix as holdings/prices change. Unset → returnRate is a custom
   *  number and is never touched. Optional so pre-existing saves load as-is. */
  returnChoice?: ReturnChoice;
  /** "Mark done" records from the Plan tab's step list: `${year}:${stepKind}` →
   *  when it was recorded and the dollars applied. Display state only — the
   *  real sync is that marking done adjusted the account balances themselves.
   *  Optional so pre-existing saves load unchanged. */
  doneActions?: Record<string, { at: number; amount: number }>;
  inflationRate: number;
  endAge: number;
  /** Whether the active plan rolls pre-tax → Roth in the low-tax window. */
  useConversions: boolean;
  /** How much to convert: "recommended" (rate-arbitrage, the default) or
   *  "fillBracket" (fill `bracketTarget` — the advanced manual lever). */
  convertMode: "recommended" | "fillBracket";
  /** Convert pre-tax → Roth each year through this (self) age. */
  convertUntilAge: number;
  /** Model the surviving-spouse years (widow's penalty). On by default. */
  survivorModel: boolean;
  /** Age of the OLDER spouse at the (assumed) first death. */
  firstDeathAge: number;
  /** Show all future figures in today's (inflation-adjusted) dollars instead of
   *  nominal future dollars. Advanced display option; default nominal. */
  realDollars: boolean;
  /** Assumed marginal tax rate a non-spouse heir pays on the inherited pre-tax,
   *  spread over the SECURE Act 10-year window. Advanced; default 24%. */
  heirTaxRate: number;
  /** Spending behavior: "constant" real (default — grows with inflation), "flatNominal"
   *  (same dollars every year), or "guardrails" (Guyton-Klinger dynamic spending). */
  spendingStrategy: "constant" | "flatNominal" | "guardrails";
  /** What happens to dividends & interest your TAXABLE accounts throw off. "reinvest"
   *  (default) → they compound in the account and do NOT cover spending (you withdraw
   *  more to cover their yearly tax). "spend" → you take them as cash that funds
   *  spending. Either way they're taxed each year. No effect on retirement-account
   *  holdings (those aren't taxed until withdrawn). */
  dividendMode: "reinvest" | "spend";
  /** For the "most money" goal: how to rank candidate plans across simulated markets.
   *  "winRate" (most often ends richest — the default), "median" (highest typical
   *  ending estate), or "mean" (highest average/upside). All run on common random
   *  numbers. Only affects the maxCapital recommendation. */
  mostMoneyMetric: "winRate" | "median" | "mean";
  /** Sex used for the Gompertz longevity model (survival curve / plan-to age).
   *  "blended" = unisex average; only affects the longevity display, not taxes. */
  selfSex: Sex;
  spouseSex: Sex;
  /** True once the user has manually adjusted the rollover (turned conversions
   *  on/off or switched smooth↔fill) away from the goal's recommendation. While
   *  false, the goal's recommended plan auto-applies — so the user never has to
   *  re-confirm or "apply" a plan after answering the goal question. Re-picking a
   *  goal resets this to false. */
  planCustomized: boolean;
}

/** Survivor spends this fraction of the couple's spending (fixed internal default). */
export const SURVIVOR_SPENDING_FACTOR = 0.8;

/** Build the projection's `survivor` assumption from settings (null = off). */
export function survivorFromSettings(s: PlannerSettings): { firstDeathAge: number; spendingFactor: number } | null {
  return s.survivorModel ? { firstDeathAge: s.firstDeathAge, spendingFactor: SURVIVOR_SPENDING_FACTOR } : null;
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  goal: "maxCapital",
  strategy: "smart",
  bracketTarget: 0.22,
  returnRate: 0.05,
  inflationRate: 0.025,
  endAge: 95,
  useConversions: false,
  convertMode: "recommended",
  convertUntilAge: 75,
  survivorModel: true,
  firstDeathAge: 85,
  realDollars: false,
  heirTaxRate: 0.24,
  spendingStrategy: "constant",
  dividendMode: "reinvest",
  mostMoneyMetric: "winRate",
  selfSex: "blended",
  spouseSex: "blended",
  planCustomized: false,
};
