/**
 * AUDIT PROBE — other-income streams (rental / annuity / other) through the tax
 * engine, planYear, and projectLifetime.
 * Run: npx tsx scripts/_audit_streams.mts
 *
 * Hand math (2026 MFJ, f=1):
 *  A. Rental $30,000 + wages $240,000: AGI 270,000 → NIIT = 3.8% × min(30,000,
 *     270,000−250,000) = 3.8% × 20,000 = $760. Same dollars as "other" income
 *     → NOT investment income → NIIT $0.
 *  B. Illinois: rental/other ARE taxed; an annuity rides the pension path and
 *     is exempt. Rental $20,000 alone: (20,000 − 2×2,925) × 4.95% = $700.43.
 *  C. Streams fund spending first: annuity 30k + rental 20k covers a $40k
 *     spend with zero withdrawals; no FICA on unearned income.
 *  D. start/end windows clip by calendar year; colaAdjusted grows with the
 *     price level (1.03² in year 2), flat streams stay flat.
 *  E. Streams survive the first death unchanged (stated shortcut).
 */
import { computeTaxes } from "../lib/tax/engine.ts";
import { planYear } from "../lib/optimizer.ts";
import { projectLifetime, ProjectionAssumptions } from "../lib/projection.ts";
import type { Household, OtherIncomeStream } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

const CY = new Date().getFullYear();
const base = {
  otherOrdinaryIncome: 0, preTaxWithdrawals: 0, socialSecurity: 0, qualifiedDividends: 0,
  longTermGains: 0, taxableInterest: 0, num65Plus: 0, year: 2026,
} as const;
const hh = (streams: OtherIncomeStream[], extra: Partial<Household> = {}): Household =>
  ({
    self: { label: "You", birthYear: CY - 65, socialSecurityAnnual: 0, ssClaimAge: 67 },
    spouse: { label: "Sp", birthYear: CY - 63, socialSecurityAnnual: 0, ssClaimAge: 67 },
    pensionAnnual: 0, annualSpending: 0, brokerageDividendsAnnual: 0, state: "IL",
    otherIncome: streams, accounts: [], ...extra,
  }) as Household;
const params = { strategy: "smart", bracketTarget: 0.22, year: CY } as const;
const assume = (over: Partial<ProjectionAssumptions> = {}): ProjectionAssumptions => ({
  strategy: "smart", bracketTarget: 0.22, returnRate: 0.05, inflationRate: 0, endAge: 90, convert: null, survivor: null, ...over,
});

// A — NIIT: rental is NII, "other" is not
const a1 = computeTaxes({ ...base, wages: 240_000, rentalIncome: 30_000 });
check("A: rental is NII → NIIT $760", Math.abs(a1.niit - 760) < 0.01, `${a1.niit}`);
const a2 = computeTaxes({ ...base, wages: 240_000, otherTaxableIncome: 30_000 });
check("A: 'other' is not NII → NIIT $0", a2.niit === 0, `${a2.niit}`);
check("A: same federal ordinary treatment otherwise", Math.abs((a1.federalTax - a1.niit) - (a2.federalTax - a2.niit)) < 0.01);

// B — Illinois character
const b1 = computeTaxes({ ...base, rentalIncome: 20_000 });
check("B: IL taxes rental ($700.43)", Math.abs(b1.state.tax - 700.43) < 0.5, `${b1.state.tax.toFixed(2)}`);
const b2 = computeTaxes({ ...base, otherTaxableIncome: 20_000 });
check("B: IL taxes 'other' the same", Math.abs(b2.state.tax - b1.state.tax) < 0.01);

// C — streams through planYear: fund spending, no FICA, annuity IL-exempt
const acct = { id: "a", label: "IRA", kind: "traditional_ira", owner: "self", balance: 500_000 } as Household["accounts"][number];
const c1 = planYear(hh([
  { id: "s1", kind: "annuity", annual: 30_000 },
  { id: "s2", kind: "rental", annual: 20_000 },
], { annualSpending: 40_000, accounts: [acct] }), params);
check("C: no withdrawals — streams cover the spend", c1.withdrawals.pretax + c1.withdrawals.taxable + c1.withdrawals.roth < 1);
check("C: fixed.otherIncome = 50,000", c1.fixed.otherIncome === 50_000, `${c1.fixed.otherIncome}`);
check("C: no payroll tax on unearned income", c1.ficaTax === 0);
check("C: note names other income", c1.notes.some((n) => n.includes("other income")));
const c2 = planYear(hh([{ id: "s1", kind: "annuity", annual: 50_000 }]), params);
check("C: annuity is IL-exempt (rides the pension path)", c2.tax.state.tax === 0, `${c2.tax.state.tax}`);
const c3 = planYear(hh([{ id: "s1", kind: "rental", annual: 50_000 }]), params);
check("C: rental is IL-taxed", c3.tax.state.tax > 2_000, `${c3.tax.state.tax.toFixed(0)}`);
check("C: netCash = fixed − income tax (no FICA)", Math.abs(c2.netCash - (50_000 - c2.tax.totalTax)) < 0.01);

// D — windows + COLA
const d = hh([{ id: "s1", kind: "rental", annual: 24_000, startYear: CY + 2, endYear: CY + 4 }]);
check("D: before startYear → 0", planYear(d, params).fixed.otherIncome === 0);
check("D: inside the window → pays", planYear(d, { ...params, year: CY + 3 }).fixed.otherIncome === 24_000);
check("D: after endYear → 0", planYear(d, { ...params, year: CY + 5 }).fixed.otherIncome === 0);
const colaProj = projectLifetime(
  hh([
    { id: "c", kind: "annuity", annual: 10_000, colaAdjusted: true },
    { id: "f", kind: "annuity", annual: 10_000 },
  ], { accounts: [{ ...acct }] }),
  assume({ inflationRate: 0.03 }),
);
check("D: COLA'd stream grows, flat stays (year 2: 10,609 + 10,000)", Math.abs(colaProj.rows[2].otherIncome - (10_000 * 1.03 * 1.03 + 10_000)) < 1, `${colaProj.rows[2].otherIncome.toFixed(0)}`);

// E — survivor keeps the streams
const e = projectLifetime(
  hh([{ id: "s1", kind: "rental", annual: 18_000 }], { annualSpending: 30_000, accounts: [{ ...acct }] }),
  assume({ survivor: { firstDeathAge: 68, spendingFactor: 0.75 } }),
);
check("E: streams survive the first death", e.rows[5].otherIncome === 18_000, `${e.rows[5].otherIncome}`);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
