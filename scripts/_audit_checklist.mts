/**
 * AUDIT PROBE — buildChecklist (the "do this in January" closing artifact).
 * Run: npx tsx scripts/_audit_checklist.mts
 *
 * Household: MFJ, both 74 (born 1952). Sam IRA $1M, Pat IRA $400k, cash
 * $150k, brokerage $200k (basis 120k). Spending $160k, smart strategy,
 * fill-bracket 22% conversion. Checks:
 *  - two RMD items, per person, amounts = balance/25.5, own-account naming
 *  - taxable item spends cash BEFORE brokerage
 *  - conversion item says "Roth conversion", warns off withholding on it,
 *    cites the conversion tax
 *  - tax item's withholding % = ceil(totalTax / pre-tax gross × 100) and
 *    quotes the safe-harbor rule
 *  - every dollar item ties out to the plan's numbers
 */
import { planYear } from "../lib/optimizer.ts";
import { buildChecklist } from "../lib/checklist.ts";
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
  annualSpending: 160_000,
  brokerageDividendsAnnual: 0,
  state: "IL",
  retirementYear: 2026,
  accounts: [
    { id: "a", label: "Fidelity IRA", kind: "traditional_ira", owner: "self", balance: 1_000_000 },
    { id: "b", label: "Vanguard IRA", kind: "traditional_ira", owner: "spouse", balance: 400_000 },
    { id: "c", label: "Savings", kind: "cash", owner: "self", balance: 150_000 },
    { id: "d", label: "Brokerage", kind: "brokerage", owner: "self", balance: 200_000, costBasis: 120_000 },
  ],
} as unknown as Household;

const plan = planYear(hh, {
  strategy: "smart",
  bracketTarget: 0.22,
  year: 2026,
  filingStatus: "mfj",
  conversion: { mode: "fillBracket", toBracket: 0.22 },
});
const items = buildChecklist(hh, plan, { yearTaxTotal: plan.tax.totalTax, irmaaLine: "test irmaa line" });

const rmds = items.filter((i) => i.kind === "rmd");
check("two per-person RMD items", rmds.length === 2, `got ${rmds.length}`);
check("Sam RMD = 1,000,000/25.5", Math.abs((rmds[0]?.amount ?? 0) - 1_000_000 / 25.5) < 1);
check("Pat RMD = 400,000/25.5", Math.abs((rmds[1]?.amount ?? 0) - 400_000 / 25.5) < 1);
check("RMDs name the owner's own account", (rmds[0]?.detail ?? "").includes("Fidelity IRA (Sam)") && (rmds[1]?.detail ?? "").includes("Vanguard IRA (Pat)"));
check("RMD deadline Dec 31", rmds.every((i) => i.deadline === "Dec 31"));

const tx = items.find((i) => i.kind === "sell");
if (plan.withdrawals.taxable > 100) {
  const cashFirst = Math.min(plan.withdrawals.taxable, 150_000);
  check("taxable item present and ties out", !!tx && Math.abs((tx.amount ?? 0) - plan.withdrawals.taxable) < 1);
  check("cash spent before brokerage", (tx?.detail ?? "").includes("Savings") || (tx?.detail ?? "").includes("cash"), tx?.detail?.slice(0, 80) ?? "");
  check("cash-first amount correct", (tx?.detail ?? "").includes(Math.round(cashFirst).toLocaleString().split(",")[0]));
} else {
  console.log("INFO  no taxable draw this year — cash-first check exercised via detail text only");
}

const conv = items.find((i) => i.kind === "convert");
check("conversion item present", !!conv && Math.abs((conv.amount ?? 0) - plan.conversion) < 1);
check("says 'Roth conversion (not a rollover)'", (conv?.detail ?? "").includes('"Roth conversion" (not a rollover)'));
check("warns off withholding on the conversion", (conv?.detail ?? "").toLowerCase().includes("decline withholding"));

const tax = items.find((i) => i.kind === "tax");
const expectedPct = Math.ceil((plan.tax.totalTax / plan.withdrawals.pretax) * 100);
check("tax item present, all-in amount", !!tax && Math.abs((tax.amount ?? 0) - plan.tax.totalTax) < 1);
if (expectedPct <= 90) check(`withholding ${expectedPct}% quoted`, (tax?.detail ?? "").includes(`withhold ${expectedPct}%`));
check("safe harbor quoted", (tax?.detail ?? "").includes("110%"));
check("irmaa line carried through", items.some((i) => i.kind === "irmaa" && i.detail === "test irmaa line"));

// Per-account splits sum to the item amount (voluntary pretax pooled pro-rata).
const vol = items.find((i) => i.kind === "withdraw");
if (vol) {
  const nums = [...(vol.detail ?? "").matchAll(/\$([\d,]+) from/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const sum = nums.reduce((s, n) => s + n, 0);
  check("voluntary pre-tax split ties out (±$300 rounding)", Math.abs(sum - (vol.amount ?? 0)) < 300, `${sum} vs ${Math.round(vol.amount ?? 0)}`);
}

// ---- Conventional strategy: forces a taxable draw big enough to exhaust cash,
// exercising the cash-first-then-brokerage split. Cash $150k < taxable need.
const hh2 = { ...hh, annualSpending: 350_000 } as unknown as Household;
const plan2 = planYear(hh2, { strategy: "conventional", bracketTarget: 0.22, year: 2026, filingStatus: "mfj", conversion: null });
const items2 = buildChecklist(hh2, plan2, { yearTaxTotal: plan2.tax.totalTax, irmaaLine: null });
const tx2 = items2.find((i) => i.kind === "sell");
check("conventional: taxable item present", !!tx2 && plan2.withdrawals.taxable > 150_000, `taxable ${Math.round(plan2.withdrawals.taxable)}`);
check("cash-first: $150,000 from Savings quoted", (tx2?.detail ?? "").includes("$150,000") && (tx2?.detail ?? "").includes("Savings"));
check("then brokerage for the remainder", (tx2?.detail ?? "").includes("then sell") && (tx2?.detail ?? "").includes("Brokerage (Sam)"));
const brokerageSell = plan2.withdrawals.taxable - 150_000;
check("brokerage remainder ties out", (tx2?.detail ?? "").includes(`sell $${Math.round(brokerageSell).toLocaleString()}`), `${Math.round(brokerageSell)}`);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll checklist checks passed");
if (fails) process.exit(1);
