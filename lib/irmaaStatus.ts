/**
 * IRMAA status for the always-visible Plan-tab meter.
 *
 * IRMAA is the one number a retiree can silently wreck mid-year: an extra
 * withdrawal that crosses a MAGI line costs the household the FULL next-tier
 * Medicare surcharge — billed two years later, when it's too late to undo.
 * This helper turns the year's MAGI into a calm dashboard readout: which tier
 * this income lands in, how much headroom is left below the next line, and
 * what crossing it would cost.
 *
 * The two-year lookback matters in BOTH directions:
 *  - This year's MAGI sets the premium two years from now, so enrollment is
 *    counted at the BILLING year (a 63-year-old is already "in the window" —
 *    their income today sets their very first premium at 65).
 *  - A brand-new retiree's CURRENT premium was set by their old working
 *    income; Form SSA-44 (life-changing event: work stoppage) gets it
 *    re-figured on retirement income. The UI surfaces that next to the meter.
 *
 * Thresholds are compared at this year's price level; the billing year's
 * thresholds will be ~2 inflation-years higher, so headroom shown here is
 * slightly conservative (never optimistic).
 */

import { Household, ageInYear } from "./accounts";
import { FILING_CONSTANTS, FilingStatus, IrmaaTier } from "./tax/constants";

export interface IrmaaStatus {
  magi: number;
  /** The year whose premium this MAGI sets (magi year + 2). */
  billingYear: number;
  /** People on Medicare now / at the billing year. */
  enrolleesNow: number;
  enrolleesAtBilling: number;
  /** True when nobody is on Medicare yet but someone will be by billing (63+):
   *  the "your income already counts" window. */
  inWindow: boolean;
  /** Tier this MAGI lands in. */
  label: string;
  inSurcharge: boolean;
  /** Surcharge this MAGI triggers at billing: per person/mo and household/yr. */
  perPersonMonthly: number;
  householdAnnual: number;
  /** Dollars of income left below the next tier line (Infinity at the top). */
  headroom: number;
  /** What crossing that next line would add, household $/yr. */
  nextJumpAnnual: number;
  atTop: boolean;
}

/**
 * Returns null when nobody is 63+ — the meter has nothing useful to say to a
 * 55-year-old, and rendering it would just be noise.
 */
export function buildIrmaaStatus(
  household: Household,
  magi: number,
  filingStatus: FilingStatus,
  year: number,
  inflationFactor = 1,
): IrmaaStatus | null {
  const spouseReal = household.spouse.birthYear > 1900;
  const selfAge = ageInYear(household.self.birthYear, year);
  const spouseAge = spouseReal ? ageInYear(household.spouse.birthYear, year) : -1;
  // A single survivor counts one enrollee at most (never the sentinel spouse).
  const count = (bump: number) =>
    filingStatus === "single"
      ? (spouseReal ? Math.min(selfAge, spouseAge) : selfAge) + bump >= 65
        ? 1
        : 0
      : (selfAge + bump >= 65 ? 1 : 0) + (spouseReal && spouseAge + bump >= 65 ? 1 : 0);
  const enrolleesNow = count(0);
  const enrolleesAtBilling = count(2);
  if (enrolleesAtBilling <= 0) return null; // nobody within the two-year window

  const tiers: IrmaaTier[] = FILING_CONSTANTS[filingStatus].irmaaTiers;
  const f = inflationFactor;
  let idx = tiers.findIndex((t) => magi <= t.upTo * f);
  if (idx < 0) idx = tiers.length - 1;
  const cur = tiers[idx];
  const atTop = idx >= tiers.length - 1;
  const next = atTop ? null : tiers[idx + 1];

  return {
    magi,
    billingYear: year + 2,
    enrolleesNow,
    enrolleesAtBilling,
    inWindow: enrolleesNow === 0,
    label: cur.label,
    inSurcharge: cur.monthlyPerPerson > 0,
    perPersonMonthly: cur.monthlyPerPerson,
    householdAnnual: cur.monthlyPerPerson * 12 * enrolleesAtBilling,
    headroom: atTop ? Infinity : cur.upTo * f - magi,
    nextJumpAnnual: next ? (next.monthlyPerPerson - cur.monthlyPerPerson) * 12 * enrolleesAtBilling : 0,
    atTop,
  };
}
