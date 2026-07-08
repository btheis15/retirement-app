/**
 * AUDIT PROBE 10 — solveBucket / planYear pathological cases + no-negative-balance.
 *  - tiny balances ($1/$0.01), zero balances, spending far above assets, zero spending.
 *  - shortfall = target − netCash (≥0), draws never exceed balances, no NaN.
 *  - projection stress: startBalances never negative; withdrawals ≤ start balances.
 *
 * Run: npx tsx scripts/_audit_proj_solver.mts
 */
import { planYear } from "../lib/optimizer.ts";
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS } from "./audit-kit.mts";
import { bucketOf } from "../lib/accounts.ts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };
const year = new Date().getFullYear();

const person = (age: number, ss: number) => ({ label: "x", birthYear: year - age, socialSecurityAnnual: ss, ssClaimAge: 67 });
const mk = (accounts: any[], spending: number, ss = 0): any => ({
  self: person(70, ss), spouse: person(68, 0), pensionAnnual: 0, annualSpending: spending,
  brokerageDividendsAnnual: 0, state: "IL", accounts,
});

const cases: { name: string; hh: any }[] = [
  { name: "tiny $1 accounts, 100k spend", hh: mk([
    { id: "1", kind: "traditional_ira", owner: "self", balance: 1, label: "" },
    { id: "2", kind: "brokerage", owner: "self", balance: 1, costBasis: 0.5, label: "" },
    { id: "3", kind: "roth_ira", owner: "self", balance: 0.01, label: "" }], 100_000) },
  { name: "zero balances, 50k spend", hh: mk([
    { id: "1", kind: "traditional_ira", owner: "self", balance: 0, label: "" },
    { id: "2", kind: "cash", owner: "self", balance: 0, costBasis: 0, label: "" }], 50_000) },
  { name: "no accounts at all", hh: mk([], 50_000, 30_000) },
  { name: "spend 10x assets", hh: mk([
    { id: "1", kind: "traditional_ira", owner: "self", balance: 100_000, label: "" },
    { id: "2", kind: "brokerage", owner: "self", balance: 50_000, costBasis: 10_000, label: "" },
    { id: "3", kind: "roth_ira", owner: "self", balance: 30_000, label: "" }], 1_800_000) },
  { name: "zero spending, big RMD", hh: mk([
    { id: "1", kind: "traditional_ira", owner: "self", balance: 5_000_000, label: "" }], 0) },
  { name: "negative-ish: basis > balance", hh: mk([
    { id: "2", kind: "brokerage", owner: "self", balance: 100_000, costBasis: 250_000, label: "" }], 60_000) },
  { name: "huge spend, cash only", hh: mk([
    { id: "2", kind: "cash", owner: "self", balance: 200_000, costBasis: 200_000, label: "" }], 500_000) },
];

for (const { name, hh } of cases) {
  for (const strategy of ["smart", "conventional", "proportional"] as const) {
    const plan = planYear(hh, { strategy, bracketTarget: 0.22, year, conversion: { mode: "fillBracket", toBracket: 0.24 } });
    const bal = {
      pretax: hh.accounts.filter((a: any) => bucketOf(a.kind) === "pretax").reduce((s: number, a: any) => s + a.balance, 0),
      taxable: hh.accounts.filter((a: any) => bucketOf(a.kind) === "taxable").reduce((s: number, a: any) => s + a.balance, 0),
      roth: hh.accounts.filter((a: any) => bucketOf(a.kind) === "roth").reduce((s: number, a: any) => s + a.balance, 0),
    };
    const vals = [plan.withdrawals.pretax, plan.withdrawals.taxable, plan.withdrawals.roth, plan.netCash, plan.shortfall, plan.tax.totalTax, plan.conversion];
    chk(vals.every((v) => Number.isFinite(v)), `${name}/${strategy}: NaN/Inf in plan: ${vals}`);
    chk(plan.withdrawals.pretax <= bal.pretax + 0.01, `${name}/${strategy}: pretax overdraw ${fmt(plan.withdrawals.pretax)} > ${fmt(bal.pretax)}`);
    chk(plan.withdrawals.taxable <= bal.taxable + 0.01, `${name}/${strategy}: taxable overdraw`);
    chk(plan.withdrawals.roth <= bal.roth + 0.01, `${name}/${strategy}: roth overdraw`);
    chk(plan.withdrawals.pretax + plan.conversion <= bal.pretax + 0.01, `${name}/${strategy}: pretax draw+conversion overdraw`);
    chk(plan.shortfall >= -0.01, `${name}/${strategy}: negative shortfall`);
    chk(Math.abs(plan.shortfall - Math.max(0, plan.spendingTarget - plan.netCash)) < 1.01, `${name}/${strategy}: shortfall ≠ max(0, target−netCash): ${plan.shortfall} vs ${plan.spendingTarget - plan.netCash}`);
    if (plan.shortfall > 1) {
      const spent = plan.withdrawals.pretax + plan.withdrawals.taxable + plan.withdrawals.roth;
      const total = bal.pretax + bal.taxable + bal.roth;
      chk(total - spent < Math.max(1, total * 1e-9), `${name}/${strategy}: shortfall reported but ${fmt(total - spent)} left undrawn`);
    }
  }
}

// Projection stress: never-negative start balances, withdrawals ≤ starts, across depleting runs.
let rowsChecked = 0;
for (const { name, hh } of cases) {
  const p = projectLifetime(hh, toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: true, convMode: "fillBracket" }, DEFAULT_INPUTS) as any);
  for (const r of p.rows as any[]) {
    rowsChecked++;
    chk(r.startBalances.pretax >= -0.01 && r.startBalances.roth >= -0.01 && r.startBalances.taxable >= -0.01, `${name} y${r.year}: negative start balance`);
    chk(r.endTotal >= -0.01, `${name} y${r.year}: negative endTotal`);
    chk(r.fromPretax <= r.startBalances.pretax + 0.01, `${name} y${r.year}: pretax draw > start`);
    chk(r.fromTaxable <= r.startBalances.taxable + 0.01, `${name} y${r.year}: taxable draw > start`);
    chk(r.fromRoth <= r.startBalances.roth + 0.01, `${name} y${r.year}: roth draw > start`);
    chk([r.tax, r.netCash, r.magi, r.irmaa, r.endTotal].every((v: number) => Number.isFinite(v)), `${name} y${r.year}: NaN in row`);
  }
  // depleted flag sanity
  const anyShort = (p.rows as any[]).some((r) => r.shortfall);
  chk(p.depleted === anyShort, `${name}: depleted flag ${p.depleted} vs rows ${anyShort}`);
}
console.log(`rows checked: ${rowsChecked}`);
console.log(bad === 0 ? "SOLVER/PATHOLOGICAL checks: ALL PASS" : `SOLVER checks: ${bad} FAILURES`);
