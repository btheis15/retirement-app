import { Household } from "./accounts";
import { BracketTarget, StrategyId } from "./optimizer";

/** A blank household for "enter my own numbers" mode. */
export function emptyHousehold(): Household {
  const thisYear = new Date().getFullYear();
  return {
    self: { label: "You", birthYear: thisYear - 63, socialSecurityAnnual: 0, ssClaimAge: 67 },
    spouse: { label: "Spouse", birthYear: thisYear - 61, socialSecurityAnnual: 0, ssClaimAge: 67 },
    pensionAnnual: 0,
    annualSpending: 120_000,
    brokerageDividendsAnnual: 0,
    accounts: [],
  };
}

export interface PlannerSettings {
  strategy: StrategyId;
  bracketTarget: BracketTarget;
  returnRate: number;
  inflationRate: number;
  endAge: number;
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  strategy: "smart",
  bracketTarget: 0.22,
  returnRate: 0.05,
  inflationRate: 0.025,
  endAge: 95,
};
