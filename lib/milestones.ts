/**
 * Decision-point detector. Scans a lifetime projection and surfaces the years
 * where the withdrawal strategy has to CHANGE or a planning lever opens/closes:
 *
 *  - Social Security claim years (income jumps; more of SS becomes taxable).
 *  - RMD start years (you're now forced to pull from pre-tax — taxes rise).
 *  - The low-tax "conversion window" between retirement and RMDs/SS, when Roth
 *    conversions or extra pre-tax withdrawals are cheapest.
 *  - First year the plan has to tap the Roth (tax-free bucket in use).
 *  - IRMAA tier crossings (Medicare premium surcharges two years later).
 *  - First year a marginal bracket steps up.
 *  - The year assets can no longer cover spending.
 *
 * These are the "you need to start pulling from X now, because Y" moments.
 */

import { Household, ageInYear } from "./accounts";
import { rmdStartAge } from "./tax/constants";
import { ProjectionResult } from "./projection";

export interface Milestone {
  year: number;
  age: number; // self age that year (reference)
  icon: string;
  title: string;
  detail: string;
  tone: "info" | "warn" | "good";
}

export function detectMilestones(household: Household, proj: ProjectionResult): Milestone[] {
  const ms: Milestone[] = [];
  const selfStart = rmdStartAge(household.self.birthYear);
  const spouseStart = rmdStartAge(household.spouse.birthYear);

  // SS claim years
  for (const who of ["self", "spouse"] as const) {
    const p = household[who];
    const year = p.birthYear + p.ssClaimAge;
    if (proj.rows.some((r) => r.year === year) && p.socialSecurityAnnual > 0) {
      ms.push({
        year,
        age: ageInYear(household.self.birthYear, year),
        icon: "💵",
        title: `${p.label} claims Social Security`,
        detail: `Benefits of about ${fmt(p.socialSecurityAnnual)}/yr begin. Up to 85% can become taxable, so lower-tax pre-tax withdrawals before this point are often worth front-loading.`,
        tone: "info",
      });
    }
  }

  // RMD start years
  for (const who of ["self", "spouse"] as const) {
    const p = household[who];
    const start = who === "self" ? selfStart : spouseStart;
    const year = p.birthYear + start;
    const row = proj.rows.find((r) => r.year === year);
    if (row) {
      ms.push({
        year,
        age: ageInYear(household.self.birthYear, year),
        icon: "📌",
        title: `${p.label}'s RMDs begin (age ${start})`,
        detail: `You're now required to pull at least ${fmt(row.rmd)} from pre-tax accounts and it's taxed as ordinary income — whether you need it or not. Drawing pre-tax down earlier shrinks these forced withdrawals.`,
        tone: "warn",
      });
    }
  }

  // Conversion window: years after both retired-ish but before first RMD & before SS.
  const firstRmdYear = Math.min(household.self.birthYear + selfStart, household.spouse.birthYear + spouseStart);
  const firstSsYear = Math.min(
    household.self.birthYear + household.self.ssClaimAge,
    household.spouse.birthYear + household.spouse.ssClaimAge,
  );
  const windowEnd = Math.min(firstRmdYear, firstSsYear) - 1;
  const windowStart = proj.rows.length ? proj.rows[0].year : new Date().getFullYear();
  if (windowEnd >= windowStart) {
    ms.push({
      year: windowStart,
      age: ageInYear(household.self.birthYear, windowStart),
      icon: "🌟",
      title: `Low-tax window: ${windowStart}–${windowEnd}`,
      detail: `Before Social Security and RMDs push your income up, your bracket is at its lowest. This is the prime time for Roth conversions or filling the 12%/22% bracket with pre-tax withdrawals to cut future RMDs.`,
      tone: "good",
    });
  }

  // First year the plan taps the Roth.
  const firstRoth = proj.rows.find((r) => r.fromRoth > 1);
  if (firstRoth) {
    ms.push({
      year: firstRoth.year,
      age: firstRoth.selfAge,
      icon: "🌱",
      title: "Roth withdrawals begin",
      detail: `The plan starts using tax-free Roth (${fmt(firstRoth.fromRoth)}) — usually to cover spending without spiking your bracket or an IRMAA tier. Roth has no RMDs, so it's the natural last-resort, tax-free buffer.`,
      tone: "good",
    });
  }

  // IRMAA tier crossings + bracket step-ups.
  let prevMarginal = -1;
  for (const r of proj.rows) {
    if (prevMarginal >= 0 && r.marginalRate > prevMarginal) {
      ms.push({
        year: r.year,
        age: r.selfAge,
        icon: "📈",
        title: `Marginal bracket rises to ${Math.round(r.marginalRate * 100)}%`,
        detail: `Income (largely from growing RMDs) pushes your top ordinary rate up to ${Math.round(
          r.marginalRate * 100,
        )}%. Consider shifting some spending to Roth or taxable here to stay under the line.`,
        tone: "warn",
      });
    }
    prevMarginal = r.marginalRate;
  }

  // Depletion.
  const depleted = proj.rows.find((r) => r.shortfall);
  if (depleted) {
    ms.push({
      year: depleted.year,
      age: depleted.selfAge,
      icon: "⚠️",
      title: "Assets fall short of spending",
      detail: `At these assumptions, withdrawals can't fully fund spending starting ${depleted.year}. Consider lower spending, later Social Security, or a different return assumption.`,
      tone: "warn",
    });
  }

  // De-dup by (year+title) and sort by year.
  const seen = new Set<string>();
  return ms
    .filter((m) => {
      const k = `${m.year}:${m.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.year - b.year);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
