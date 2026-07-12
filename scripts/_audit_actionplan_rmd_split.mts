/**
 * AUDIT PROBE — per-person RMD split in the action plan.
 * Run: npx tsx scripts/_audit_actionplan_rmd_split.mts
 *
 * Household: MFJ, both born 1952 (age 74 in 2026 → RMDs due, start age 73).
 * Self IRA $1,000,000; Spouse IRA $400,000. Uniform Lifetime factor at 74 is
 * 25.5 → RMDs 39,215.69 and 15,686.27 (hand math: balance / 25.5).
 *
 * Expect: the CURRENT year's action list shows TWO rmd actions with those
 * amounts ("from their own accounts"); later years fall back to ONE pooled
 * action (the projection doesn't track per-owner balances).
 */
import { buildActionPlan } from "../lib/actionPlan.ts";
import { projectLifetime } from "../lib/projection.ts";
import type { Household } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

const hh = {
  self: { label: "Sam", birthYear: 1952, socialSecurityAnnual: 30_000, ssClaimAge: 67 },
  spouse: { label: "Pat", birthYear: 1952, socialSecurityAnnual: 20_000, ssClaimAge: 67 },
  pensionAnnual: 0,
  annualSpending: 90_000,
  brokerageDividendsAnnual: 0,
  state: "IL",
  retirementYear: 2026,
  accounts: [
    { id: "a", label: "Sam IRA", kind: "traditional_ira", owner: "self", balance: 1_000_000 },
    { id: "b", label: "Pat IRA", kind: "traditional_ira", owner: "spouse", balance: 400_000 },
    { id: "c", label: "Cash", kind: "cash", owner: "self", balance: 300_000 },
  ],
} as unknown as Household;

const proj = projectLifetime(hh, {
  strategy: "smart",
  bracketTarget: 0.22,
  startYear: 2026,
  endAge: 90,
  returnRate: 0.05,
  inflationRate: 0.025,
  filingStatus: "mfj",
});
const plan = buildActionPlan(hh, proj, 4);

const y0 = plan[0];
const rmdActs = y0.actions.filter((a) => a.kind === "rmd");
check("current year: two per-person RMD actions", rmdActs.length === 2, `got ${rmdActs.length}`);
check("Sam's RMD ≈ 39,216 (1,000,000 / 25.5)", Math.abs((rmdActs[0]?.amount ?? 0) - 1_000_000 / 25.5) < 1);
check("Pat's RMD ≈ 15,686 (400,000 / 25.5)", Math.abs((rmdActs[1]?.amount ?? 0) - 400_000 / 25.5) < 1);
check("split ties out to the row total", Math.abs(rmdActs.reduce((s, a) => s + a.amount, 0) - proj.rows[0].rmd) < 1);
check("names + own-accounts wording present", rmdActs.every((a) => /Sam|Pat/.test(a.text) && a.text.includes("own pre-tax accounts")));
check("deadline in text", rmdActs.every((a) => a.text.includes("Dec 31")));

const y1 = plan[1];
const rmdNext = y1.actions.filter((a) => a.kind === "rmd");
check("later years: one pooled RMD action", rmdNext.length === 1, `got ${rmdNext.length}`);
check("later years: no stale Dec-31 stamp", !rmdNext[0]?.text.includes("Dec 31"));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll action-plan RMD-split checks passed");
if (fails) process.exit(1);
