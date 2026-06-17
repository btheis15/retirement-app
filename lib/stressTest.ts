/**
 * Deterministic STRESS TESTS — "what if the worst happens right as you retire?"
 *
 * Monte Carlo answers "how often does it work across random markets." Stress
 * tests answer the complementary question advisors get asked: "what if I retire
 * straight into a crash / a lost decade?" Each scenario feeds a fixed sequence of
 * annual portfolio returns into the lifetime projection (then reverts to the
 * baseline expected return), isolating sequence-of-returns risk — the single
 * biggest threat to an early retiree.
 *
 * Sequences are representative; the historical ones use actual S&P 500 annual
 * total returns for the named years (applied at the portfolio level — a
 * conservative read for a stock-heavy investor).
 *
 * ⚠️ Educational estimates only.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";

export interface StressScenario {
  id: string;
  name: string;
  description: string;
  /** Portfolio annual returns for the first N years; later years use baseline. */
  returns: number[];
}

/** The canonical sequence-of-returns stress scenarios. */
export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: "crash",
    name: "Crash at retirement",
    description: "A −35% market drop in your very first year, then a normal recovery.",
    returns: [-0.35],
  },
  {
    id: "badstart",
    name: "Two rough years to start",
    description: "Back-to-back down years (−20%, −15%) right at the start — the classic sequence-risk trap.",
    returns: [-0.2, -0.15],
  },
  {
    id: "gfc2008",
    name: "Retire into 2008",
    description: "The 2008 crash (−37%) and the recovery that followed (actual S&P 500 returns, 2008–2013).",
    returns: [-0.37, 0.265, 0.151, 0.021, 0.16, 0.324],
  },
  {
    id: "lostdecade",
    name: "The 2000s “lost decade”",
    description: "Dot-com bust then 2008 — actual S&P 500 returns 2000–2009, a flat decade with two crashes.",
    returns: [-0.091, -0.119, -0.221, 0.287, 0.109, 0.049, 0.158, 0.055, -0.37, 0.265],
  },
];

export interface StressResult {
  scenario: StressScenario;
  endingEstateAfterTax: number;
  /** Lowest total balance reached, and the age it happened. */
  minBalance: number;
  minBalanceAge: number;
  depleted: boolean;
  depletionAge: number; // 0 if it never runs short
}

export function runStressTests(
  household: Household,
  assumptions: ProjectionAssumptions,
  scenarios: StressScenario[] = STRESS_SCENARIOS,
): StressResult[] {
  const baseline = assumptions.returnRate;
  return scenarios.map((s) => {
    const returnFor = (i: number) => (i < s.returns.length ? s.returns[i] : baseline);
    const proj = projectLifetime(household, { ...assumptions, returnFor });
    let minBalance = Infinity;
    let minBalanceAge = 0;
    let depletionAge = 0;
    for (const row of proj.rows) {
      if (row.endTotal < minBalance) {
        minBalance = row.endTotal;
        minBalanceAge = row.selfAge;
      }
      if (row.shortfall && depletionAge === 0) depletionAge = row.selfAge;
    }
    return {
      scenario: s,
      endingEstateAfterTax: proj.endingEstateAfterTax,
      minBalance: minBalance === Infinity ? 0 : minBalance,
      minBalanceAge,
      depleted: proj.depleted,
      depletionAge,
    };
  });
}
