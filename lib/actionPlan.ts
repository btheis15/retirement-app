/**
 * "Looking ahead" — turns the chosen plan's lifetime projection into a concrete,
 * year-by-year to-do list for the next several years, so the user can see what
 * they actually have to DO and plan around it (not just a chart).
 *
 * Each step is plain English in the user's own dollars: take the RMD, roll some
 * pre-tax to Roth, sell from the brokerage, etc. — plus the notable life events
 * that change the plan (Social Security starts, RMDs begin).
 *
 * ⚠️ Educational estimates only — not tax advice.
 */

import { Household } from "./accounts";
import { ProjectionResult, ProjectionRow } from "./projection";
import { rmdStartAge } from "./tax/constants";
import { computeRmd } from "./optimizer";
import { money } from "./format";

export interface PlanAction {
  kind: "rmd" | "pretax" | "convert" | "taxable" | "roth" | "none";
  text: string;
  amount: number;
}

export interface PlanYear {
  year: number;
  selfAge: number;
  spouseAge: number;
  /** Notable events that begin THIS year (claim SS, RMDs start). */
  events: string[];
  actions: PlanAction[];
  tax: number;
  spendingTarget: number;
  /** True if guaranteed income alone covered spending (no withdrawals). */
  coveredByIncome: boolean;
}

function eventsForYear(household: Household, row: ProjectionRow): string[] {
  const events: string[] = [];
  for (const who of ["self", "spouse"] as const) {
    const p = household[who];
    if (p.socialSecurityAnnual > 0 && p.birthYear + p.ssClaimAge === row.year) {
      events.push(`${p.label} starts Social Security`);
    }
    if (p.birthYear + rmdStartAge(p.birthYear) === row.year) {
      events.push(`${p.label}'s RMDs begin`);
    }
  }
  return events;
}

function actionsForRow(household: Household, row: ProjectionRow, isCurrentYear: boolean): PlanAction[] {
  const actions: PlanAction[] = [];
  const voluntaryPretax = Math.max(0, row.fromPretax - row.rmd);

  if (row.rmd > 0.5) {
    // For THIS year the live balances give the exact per-person split — and each
    // person's RMD must legally come out of their OWN pre-tax accounts, so a
    // couple needs the two numbers, not the household total. Future years keep
    // the pooled figure (the projection doesn't track per-owner balances), and
    // the split is only shown when it ties out to the row's total.
    const details = isCurrentYear ? computeRmd(household, row.year).details.filter((d) => d.amount > 0.5) : [];
    const tiesOut = Math.abs(details.reduce((s, d) => s + d.amount, 0) - row.rmd) < 1;
    if (details.length > 1 && tiesOut) {
      for (const d of details) {
        const name = household[d.owner].label || (d.owner === "self" ? "You" : "Spouse");
        actions.push({
          kind: "rmd",
          amount: d.amount,
          text: `Take ${name}'s required RMD of ${money(d.amount)} — from ${name === "You" ? "your" : "their"} own pre-tax accounts, by Dec 31`,
        });
      }
    } else {
      actions.push({
        kind: "rmd",
        amount: row.rmd,
        text: `Take your required RMD of ${money(row.rmd)} from pre-tax${isCurrentYear ? " (by Dec 31)" : ""}`,
      });
    }
  }
  if (voluntaryPretax > 0.5) {
    actions.push({
      kind: "pretax",
      amount: voluntaryPretax,
      // "more" only makes sense on top of an RMD row — without one it implies a
      // withdrawal that never appears anywhere.
      text: row.rmd > 0.5 ? `Withdraw ${money(voluntaryPretax)} more from pre-tax to fund spending` : `Withdraw ${money(voluntaryPretax)} from pre-tax to fund spending`,
    });
  }
  if (row.conversion > 0.5) {
    actions.push({
      kind: "convert",
      amount: row.conversion,
      text: `Roll ${money(row.conversion)} from pre-tax → Roth (conversion)`,
    });
  }
  if (row.fromTaxable > 0.5) {
    actions.push({ kind: "taxable", amount: row.fromTaxable, text: `Sell ${money(row.fromTaxable)} from your brokerage` });
  }
  if (row.fromRoth > 0.5) {
    actions.push({ kind: "roth", amount: row.fromRoth, text: `Tap ${money(row.fromRoth)} from Roth (tax-free)` });
  }
  if (actions.length === 0) {
    actions.push({ kind: "none", amount: 0, text: "Income covers your spending — no withdrawals needed" });
  }
  return actions;
}

/**
 * Build the next `years` years of the action plan from a projection.
 */
export function buildActionPlan(household: Household, proj: ProjectionResult, years = 6): PlanYear[] {
  return proj.rows.slice(0, years).map((row, i) => {
    const withdrawals = row.fromPretax + row.fromTaxable + row.fromRoth;
    return {
      year: row.year,
      selfAge: row.selfAge,
      spouseAge: row.spouseAge,
      events: eventsForYear(household, row),
      actions: actionsForRow(household, row, i === 0),
      tax: row.tax,
      spendingTarget: row.spendingTarget,
      coveredByIncome: withdrawals < 0.5 && row.conversion < 0.5,
    };
  });
}
