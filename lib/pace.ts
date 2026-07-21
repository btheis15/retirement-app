/**
 * Year pace — turns the year's plan into "where should I be TODAY?"
 *
 * The plan says things like "withdraw $150,000 this year and roll $60,000 to
 * Roth." A retiree opening the app in July needs that translated into a pace:
 * roughly how much per month, how much should already be done by now, and which
 * real calendar deadlines are coming up (quarterly estimated taxes, the Dec 31
 * RMD/conversion deadline, Medicare open enrollment). Pure and date-injected so
 * it's testable; the UI passes `new Date()`.
 *
 * ⚠️ Educational estimates only — not tax, legal, or investment advice.
 */

import { YearPlan } from "./optimizer";

export interface PaceItem {
  /** Short label, e.g. "Withdraw from savings". */
  label: string;
  /** Total planned for the year (nominal dollars). */
  annual: number;
  /** annual / 12 — the steady monthly pace. */
  monthly: number;
  /** Pro-rata amount that "should" be done by today (annual × yearFraction). */
  byNow: number;
  tone: "taxable" | "deferred" | "roth" | "tax" | "ss";
}

export interface PaceDeadline {
  /** e.g. "Sep 15" */
  when: string;
  date: Date;
  label: string;
  detail: string;
  /** Days from `now` (0 = today). */
  inDays: number;
}

export interface YearPace {
  year: number;
  monthName: string;
  /** 0..1 — how far through the calendar year today is (by day). */
  yearFraction: number;
  /** Months fully elapsed, 0–11. */
  monthsDone: number;
  items: PaceItem[];
  /** Steady monthly guaranteed income (SS + pension + spent dividends). */
  guaranteedMonthly: number;
  /** The year's spending target / 12. */
  spendingMonthly: number;
  /** Total savings draw for the year (all buckets, RMD included). */
  totalDraw: number;
  /** This year's Roth conversion (0 when none). */
  conversion: number;
  /** Suggested per-quarter estimated-tax payment (totalTax / 4), 0 if trivial. */
  estTaxQuarterly: number;
  deadlines: PaceDeadline[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtWhen(d: Date): string {
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** IRS Form 1040-ES due dates covering the given tax year. */
function estimatedTaxDates(year: number): Date[] {
  return [
    new Date(year, 3, 15), // Apr 15
    new Date(year, 5, 15), // Jun 15
    new Date(year, 8, 15), // Sep 15
    new Date(year + 1, 0, 15), // Jan 15 next year
  ];
}

export function buildYearPace(
  plan: YearPlan,
  opts: {
    now: Date;
    medicareEligible: boolean;
    /** Tax the caller knows about beyond this plan's own (e.g. the active
     *  projection's conversion tax when `plan` was computed without it). */
    extraTax?: number;
  },
): YearPace {
  const now = opts.now;
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);
  const yearFraction = Math.min(1, Math.max(0, (now.getTime() - startOfYear.getTime()) / (endOfYear.getTime() - startOfYear.getTime())));
  const monthsDone = now.getMonth();

  const w = plan.withdrawals;
  const totalDraw = w.pretax + w.taxable + w.roth;
  const item = (label: string, annual: number, tone: PaceItem["tone"]): PaceItem => ({
    label,
    annual,
    monthly: annual / 12,
    byNow: annual * yearFraction,
    tone,
  });

  const yearTax = plan.tax.totalTax + plan.conversionTax + (opts.extraTax ?? 0);
  const items: PaceItem[] = [];
  if (totalDraw > 0.5) items.push(item("Withdraw from savings", totalDraw, "taxable"));
  // The tax set-aside is paced too — whether withheld from withdrawals or paid
  // as quarterly estimates, the money has to be reserved as the year goes. It
  // includes the Roth conversion's tax so the pace never understates the bill.
  if (yearTax > 0.5) items.push(item("Set aside for income tax", yearTax, "tax"));

  // Steady checks only (SS + pension + other streams + take-home pay while
  // working). Dividend/interest cash-outs are lumpy and already counted inside
  // the plan's funding math, so they aren't paced here.
  const guaranteedMonthly =
    (plan.fixed.socialSecurity + plan.fixed.pension + plan.fixed.otherIncome + Math.max(0, plan.fixed.wages - plan.ficaTax)) / 12;

  // Real calendar anchors, soonest first. Only future dates within ~14 months.
  const deadlines: PaceDeadline[] = [];
  const push = (date: Date, label: string, detail: string) => {
    const inDays = daysBetween(now, date);
    if (inDays < 0 || inDays > 430) return;
    deadlines.push({ when: fmtWhen(date), date, label, detail, inDays });
  };

  const estTaxQuarterly = yearTax >= 4_000 ? yearTax / 4 : 0;
  if (estTaxQuarterly > 0) {
    const next = estimatedTaxDates(year).find((d) => d >= now);
    if (next) {
      push(
        next,
        "Quarterly estimated tax",
        "If you pay estimates rather than withholding from withdrawals, the next IRS 1040-ES installment is due.",
      );
    }
  }
  if (plan.rmd > 0.5) {
    push(new Date(year, 11, 31), "RMD deadline", "Your required minimum distribution must be fully out of pre-tax accounts by December 31.");
  }
  if (plan.conversion > 0.5) {
    push(
      new Date(year, 11, 31),
      "Roth conversion deadline",
      "A conversion counts for the year it happens — complete it by December 31. One transfer or a few chunks both work.",
    );
  }
  if (opts.medicareEligible) {
    const oeStart = new Date(year, 9, 15); // Oct 15
    const oeEnd = new Date(year, 11, 7); // Dec 7
    push(now <= oeEnd ? oeStart : new Date(year + 1, 9, 15), "Medicare open enrollment", "Review your Part D / Advantage coverage — Oct 15 to Dec 7 every year.");
  }
  deadlines.sort((a, b) => a.inDays - b.inDays);

  return {
    year,
    monthName: MONTHS[now.getMonth()],
    yearFraction,
    monthsDone,
    items,
    guaranteedMonthly,
    spendingMonthly: plan.spendingTarget / 12,
    totalDraw,
    conversion: plan.conversion,
    estTaxQuarterly,
    deadlines,
  };
}
