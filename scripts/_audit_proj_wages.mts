/**
 * AUDIT PROBE — wages through planYear and projectLifetime.
 * Run: npx tsx scripts/_audit_proj_wages.mts
 *
 * Hand math anchors:
 *  - FICA: $120,000 W-2 → 7.65% = $9,180; self-employed → 15.3% = $18,360.
 *  - Stop-year proration: lastWorkMonth 6 → 6/12 × $120,000 = $60,000.
 *  - COLA: year-2 wages at 3% inflation = 120,000 × 1.03² = $127,308 (the
 *    inflation index is the price level at the year's START: 1, 1.03, 1.03²…).
 *  - Wage netCash identity: netCash = wages − income tax − FICA (no accounts).
 *  - Surplus conservation: endTotal = (start + netCash − spendingTarget) × 1.05
 *    when wages exceed spending (surplus reinvests, then growth applies).
 */
import { planYear } from "../lib/optimizer.ts";
import { projectLifetime, ProjectionAssumptions } from "../lib/projection.ts";
import { wageForYear } from "../lib/accounts.ts";
import type { Household, WorkIncome } from "../lib/accounts.ts";
import { DEMO_HOUSEHOLD } from "./audit-kit.mts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

const CY = new Date().getFullYear();
const hh = (selfWork?: WorkIncome, spouseWork?: WorkIncome, extra: Partial<Household> = {}): Household =>
  ({
    self: { label: "You", birthYear: CY - 65, socialSecurityAnnual: 0, ssClaimAge: 67, work: selfWork },
    spouse: { label: "Sp", birthYear: CY - 63, socialSecurityAnnual: 0, ssClaimAge: 67, work: spouseWork },
    pensionAnnual: 0,
    annualSpending: 0,
    brokerageDividendsAnnual: 0,
    state: "IL",
    accounts: [],
    ...extra,
  }) as Household;
const params = { strategy: "smart", bracketTarget: 0.22, year: CY } as const;
const assume = (over: Partial<ProjectionAssumptions> = {}): ProjectionAssumptions => ({
  strategy: "smart",
  bracketTarget: 0.22,
  returnRate: 0.05,
  inflationRate: 0,
  endAge: 90,
  convert: null,
  survivor: null,
  ...over,
});

// ── FICA vs SE tax, and the netCash identity ─────────────────────────────────
const w2 = planYear(hh({ annualWages: 120_000, lastWorkYear: CY + 5 }), params);
check("W-2 FICA $9,180", Math.abs(w2.ficaTax - 9_180) < 0.01, `${w2.ficaTax}`);
check("fixed.wages carries the gross", w2.fixed.wages === 120_000, `${w2.fixed.wages}`);
check("netCash = wages − income tax − FICA", Math.abs(w2.netCash - (120_000 - w2.tax.totalTax - 9_180)) < 0.01);
check("FICA is NOT income tax (set-asides stay honest)", w2.tax.totalTax < 120_000 * 0.3 && w2.ficaTax > 0);
const se = planYear(hh({ annualWages: 120_000, lastWorkYear: CY + 5, selfEmployed: true }), params);
check("self-employed pays 15.3% ($18,360)", Math.abs(se.ficaTax - 18_360) < 0.01, `${se.ficaTax}`);
check("same income tax either way (SE tax isn't income tax)", Math.abs(se.tax.totalTax - w2.tax.totalTax) < 0.01);

// ── Wages fund spending first: withdrawals shrink vs a wage-free twin ────────
const acct = { id: "a", label: "IRA", kind: "traditional_ira", owner: "self", balance: 500_000 } as Household["accounts"][number];
const working = planYear(hh({ annualWages: 120_000, lastWorkYear: CY + 5 }, undefined, { annualSpending: 80_000, accounts: [acct] }), params);
check("worker needs no withdrawals at $80k spend", working.withdrawals.pretax + working.withdrawals.taxable + working.withdrawals.roth < 1, JSON.stringify(working.withdrawals));
check("note names work income", working.notes.some((n) => n.toLowerCase().includes("work income")));
const idle = planYear(hh(undefined, undefined, { annualSpending: 80_000, accounts: [{ ...acct }] }), params);
check("wage-free twin must withdraw", idle.withdrawals.pretax > 50_000, `${idle.withdrawals.pretax.toFixed(0)}`);

// ── Stop-year proration + the override + the retirementYear fallback ─────────
check("lastWorkMonth 6 → half-year wages", planYear(hh({ annualWages: 120_000, lastWorkYear: CY, lastWorkMonth: 6 }), params).fixed.wages === 60_000);
check("year after lastWorkYear → 0", planYear(hh({ annualWages: 120_000, lastWorkYear: CY }), { ...params, year: CY + 1 }).fixed.wages === 0);
check("thisYearWages overrides the current year only", planYear(hh({ annualWages: 120_000, thisYearWages: 80_000, lastWorkYear: CY + 2 }), params).fixed.wages === 80_000);
check("…but not later years", planYear(hh({ annualWages: 120_000, thisYearWages: 80_000, lastWorkYear: CY + 2 }), { ...params, year: CY + 1 }).fixed.wages === 120_000);
const fallback = hh({ annualWages: 90_000 }, undefined, { retirementYear: CY + 3 });
check("lastWorkYear unset → household retirementYear", wageForYear(fallback.self, fallback, CY + 3) === 90_000 && wageForYear(fallback.self, fallback, CY + 4) === 0);

// ── COLA through the projection (wages ride the price level) ─────────────────
const colaProj = projectLifetime(hh({ annualWages: 120_000, lastWorkYear: CY + 5 }, undefined, { annualSpending: 0, accounts: [{ ...acct }] }), assume({ inflationRate: 0.03 }));
check("year-0 wages $120,000", Math.abs(colaProj.rows[0].wages - 120_000) < 1, `${colaProj.rows[0].wages}`);
check("year-2 wages 120,000×1.03² = 127,308", Math.abs(colaProj.rows[2].wages - 127_308) < 1, `${colaProj.rows[2].wages.toFixed(0)}`);
check("wages stop after lastWorkYear", colaProj.rows[6].wages === 0 && colaProj.rows[5].wages > 0);

// ── Surplus wages reinvest, then growth (conservation) ───────────────────────
const brok = { id: "b", label: "Brokerage", kind: "brokerage", owner: "self", balance: 10_000, costBasis: 10_000 } as Household["accounts"][number];
const sur = projectLifetime(hh({ annualWages: 200_000, lastWorkYear: CY + 5 }, undefined, { annualSpending: 50_000, accounts: [brok] }), assume());
const r0 = sur.rows[0];
check("wages leave a surplus", r0.netCash - r0.spendingTarget > 50_000, `${(r0.netCash - r0.spendingTarget).toFixed(0)}`);
check(
  "endTotal = (start + surplus) × 1.05 (conservation)",
  Math.abs(r0.endTotal - (10_000 + (r0.netCash - r0.spendingTarget)) * 1.05) < 2,
  `${r0.endTotal.toFixed(0)}`,
);

// ── Survivor transition kills the deceased's wages, keeps the survivor's ─────
const both = hh({ annualWages: 100_000, lastWorkYear: CY + 20 }, { annualWages: 100_000, lastWorkYear: CY + 20 }, { annualSpending: 60_000, accounts: [{ ...acct }] });
const survProj = projectLifetime(both, assume({ survivor: { firstDeathAge: 68, spendingFactor: 0.75 } }));
// Older spouse (self, 65) reaches 68 in year 3 → from then only the spouse's wages.
check("both work before the death year", Math.abs(survProj.rows[2].wages - 200_000) < 1, `${survProj.rows[2].wages}`);
check("only the survivor's wages after", Math.abs(survProj.rows[3].wages - 100_000) < 1, `${survProj.rows[3].wages}`);

// ── Monte-Carlo path (returnFor) still carries wages; demo stays wage-free ───
const mc = projectLifetime(hh({ annualWages: 120_000, lastWorkYear: CY + 5 }), assume({ returnFor: () => 0.05 }));
check("MC path carries wages", mc.rows[0].wages === 120_000);
const demo = projectLifetime(DEMO_HOUSEHOLD, assume());
check("demo household has no wages anywhere", demo.rows.every((r) => r.wages === 0));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
