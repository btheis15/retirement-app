/**
 * Longevity / survival model — Gompertz law, with parameters CALIBRATED offline
 * to the SSA 2021 period life table (see research/mortality.py). This is the
 * Milevsky-style approach to retirement longevity: instead of a crude "plan to
 * 95," we model the *probability* of being alive at each age and, for a couple,
 * the probability the LAST survivor is alive — because the money has to last
 * until both have died.
 *
 * Gompertz force of mortality:   mu(x) = (1/b) * exp((x - m) / b)
 * t-year survival from age x:    S(x, t) = exp( exp((x-m)/b) * (1 - exp(t/b)) )
 *   m = modal age at death, b = dispersion.
 *
 * The m/b constants live in lib/calibrated/mortality.json (regenerate with
 * `python3 -m research.mortality`). Validated there against published life
 * expectancy at 65 and P(reach 90/95).
 */

import calibrated from "./calibrated/mortality.json";

export type Sex = "male" | "female" | "blended";

export interface GompertzParams {
  m: number;
  b: number;
}

/** Calibrated Gompertz (m, b) for a given sex (defaults to the unisex blend). */
export function paramsFor(sex: Sex = "blended"): GompertzParams {
  if (sex === "blended") return { m: calibrated.blended.m, b: calibrated.blended.b };
  const p = calibrated.sex[sex];
  return { m: p.m, b: p.b };
}

/** Probability of surviving `t` more years from `age`, under Gompertz(m, b). */
export function survival(age: number, t: number, p: GompertzParams): number {
  if (t <= 0) return 1;
  const s = Math.exp(Math.exp((age - p.m) / p.b) * (1 - Math.exp(t / p.b)));
  return Math.min(1, Math.max(0, s));
}

/** Probability of being alive AT a given target age, conditional on being alive at `fromAge`. */
export function survivalToAge(fromAge: number, targetAge: number, p: GompertzParams): number {
  return survival(fromAge, targetAge - fromAge, p);
}

/**
 * Last-survivor (joint) survival for a couple, treating the two lives as
 * independent: P(at least one alive) = 1 - (1 - S_a)(1 - S_b). This is the
 * horizon that matters for a household's money lasting.
 */
export function jointSurvivalToAge(
  a: { age: number; p: GompertzParams },
  b: { age: number; p: GompertzParams },
  targetCalendarOffset: number,
): number {
  const sa = survival(a.age, targetCalendarOffset, a.p);
  const sb = survival(b.age, targetCalendarOffset, b.p);
  return 1 - (1 - sa) * (1 - sb);
}

/** Curtate life expectancy from `age` (Σ survival probabilities), capped at 120. */
export function lifeExpectancy(age: number, p: GompertzParams): number {
  let e = 0;
  for (let t = 1; age + t <= 120; t++) e += survival(age, t, p);
  return age + e;
}

export interface SurvivalPoint {
  age: number;
  /** P(the `self` life is alive at this age). */
  self: number;
  /** P(the `spouse` life is alive at this age). */
  spouse: number;
  /** P(at least one of the couple is alive at this age) — the planning horizon. */
  either: number;
}

/**
 * Build the survival curve for a couple from `currentYear` out to age 105 of the
 * younger spouse. Each point is indexed by the SELF age for charting alongside
 * the projection.
 */
export function survivalCurve(
  self: { currentAge: number; sex?: Sex },
  spouse: { currentAge: number; sex?: Sex } | null,
  maxAge = 105,
): SurvivalPoint[] {
  const ps = paramsFor(self.sex);
  const pp = spouse ? paramsFor(spouse.sex) : null;
  const out: SurvivalPoint[] = [];
  for (let age = self.currentAge; age <= maxAge; age++) {
    const t = age - self.currentAge;
    const sSelf = survival(self.currentAge, t, ps);
    const sSpouse = spouse && pp ? survival(spouse.currentAge, t, pp) : 0;
    const either = spouse && pp ? 1 - (1 - sSelf) * (1 - sSpouse) : sSelf;
    out.push({ age, self: sSelf, spouse: sSpouse, either });
  }
  return out;
}

/**
 * The age the household should plan to: the SELF age at which the last survivor
 * has only `tailProb` chance of still being alive (default 10%). This is the
 * defensible "plan-to" horizon — covering all but the longevity tail.
 */
export function planningHorizonAge(
  self: { currentAge: number; sex?: Sex },
  spouse: { currentAge: number; sex?: Sex } | null,
  tailProb = 0.1,
  maxAge = 110,
): number {
  const ps = paramsFor(self.sex);
  const pp = spouse ? paramsFor(spouse.sex) : null;
  for (let age = self.currentAge + 1; age <= maxAge; age++) {
    const t = age - self.currentAge;
    const sSelf = survival(self.currentAge, t, ps);
    const sSpouse = spouse && pp ? survival(spouse.currentAge, t, pp) : 0;
    const either = spouse && pp ? 1 - (1 - sSelf) * (1 - sSpouse) : sSelf;
    if (either <= tailProb) return age;
  }
  return maxAge;
}

/** P(at least one survivor reaches a target SELF age) — for plain-language copy. */
export function probReachAge(
  self: { currentAge: number; sex?: Sex },
  spouse: { currentAge: number; sex?: Sex } | null,
  targetSelfAge: number,
): number {
  const ps = paramsFor(self.sex);
  const pp = spouse ? paramsFor(spouse.sex) : null;
  const t = targetSelfAge - self.currentAge; // calendar span — same for both lives
  const sSelf = survival(self.currentAge, t, ps);
  const sSpouse = spouse && pp ? survival(spouse.currentAge, t, pp) : 0;
  return spouse && pp ? 1 - (1 - sSelf) * (1 - sSpouse) : sSelf;
}

export const MORTALITY_META = {
  source: calibrated.source,
  model: calibrated.model as string,
};
