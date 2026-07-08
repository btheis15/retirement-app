/**
 * AUDIT PROBE 4 — Roth conversion mechanics through the accounts.
 *  - Gross leaves pre-tax; net (gross − withheld) credited to Roth; tax from cash only.
 *  - Cash-insufficient case: withheld portion NOT credited to Roth.
 *  - No conversion in shortfall years (across archetypes/configs).
 *  - Conversion never exceeds remaining pre-tax.
 * Uses year-over-year startBalances from projectLifetime rows (r=0 so growth
 * doesn't obscure the flows) and hand-computes the expected bucket movements.
 *
 * Run: npx tsx scripts/_audit_proj_conversion.mts
 */
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS, archetypes, adjustedAnnualBenefit } from "./audit-kit.mts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };
const year = new Date().getFullYear();

function mk(cash: number): any {
  return {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 40_000, ssClaimAge: 65 },
    spouse: { label: "B", birthYear: year - 64, socialSecurityAnnual: 20_000, ssClaimAge: 65 },
    pensionAnnual: 0,
    annualSpending: 40_000, // SS covers most of it → room to convert
    brokerageDividendsAnnual: 0,
    state: "IL",
    accounts: [
      { id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 2_000_000 },
      { id: "r", label: "", kind: "roth_ira", owner: "self", balance: 100_000 },
      { id: "c", label: "", kind: "cash", owner: "self", balance: cash, costBasis: cash },
    ],
  };
}

for (const cash of [500_000, 30_000, 5_000, 0]) {
  const hh = mk(cash);
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.24, conv: true, convMode: "fillBracket" }, { ...DEFAULT_INPUTS, survivor: null }, { returnRate: 0, inflationRate: 0 }) as any;
  const p = projectLifetime(hh, A);
  // Year 1 flows → year 2 startBalances (r=0, inflation=0 so no growth noise)
  const r0: any = p.rows[0];
  const r1: any = p.rows[1];
  chk(r0.conversion > 0, `cash=${fmt(cash)}: expected a conversion in year 1`);
  // reconstruct year-1 flows
  const g = r0.conversion;
  // conversionTax = row.tax (with conv) minus tax(no conv). netCash = inflow − taxNoConv.
  // Only self has claimed (66 >= 65); benefit reduced for claiming at 65 (FRA 67).
  const ss = adjustedAnnualBenefit(40_000, hh.self.birthYear, 65);
  const draws = r0.fromPretax + r0.fromTaxable + r0.fromRoth;
  const taxNoConv = ss + draws - r0.netCash;
  const convTax = r0.tax - taxNoConv;
  let cashBal = Math.max(0, cash - r0.fromTaxable); // taxable draw is cash-first; only taxable account is cash
  const paid = Math.min(cashBal, convTax);
  cashBal -= paid;
  const withheld = Math.max(0, convTax - paid);
  const leftover = r0.netCash - r0.spendingTarget;
  const reinvestAmt = Math.max(0, leftover - r0.irmaa);
  const premiumFromSavings = Math.min(cashBal, Math.max(0, r0.irmaa - Math.max(0, leftover))); // clamped at balance
  const expPretax = 2_000_000 - r0.fromPretax - g;
  const expRoth = 100_000 - r0.fromRoth + Math.max(0, g - withheld);
  // reinvested surplus: no brokerage account exists → falls to first taxable (the cash account!)
  const expTaxable = cashBal - premiumFromSavings + reinvestAmt;
  chk(Math.abs(r1.startBalances.pretax - expPretax) < 1, `cash=${fmt(cash)}: pretax y2 ${fmt(r1.startBalances.pretax)} want ${fmt(expPretax)}`);
  chk(Math.abs(r1.startBalances.roth - expRoth) < 1, `cash=${fmt(cash)}: roth y2 ${fmt(r1.startBalances.roth)} want ${fmt(expRoth)} (gross ${fmt(g)}, convTax ${fmt(convTax)}, paid ${fmt(paid)}, withheld ${fmt(withheld)})`);
  chk(Math.abs(r1.startBalances.taxable - expTaxable) < 1, `cash=${fmt(cash)}: taxable y2 ${fmt(r1.startBalances.taxable)} want ${fmt(expTaxable)}`);
  console.log(`cash=${fmt(cash)}: conv ${fmt(g)}, convTax ${fmt(convTax)}, paidFromCash ${fmt(paid)}, withheld ${fmt(withheld)} → roth +${fmt(Math.max(0, g - withheld))} ✓`);
}

// --- no conversion in shortfall years; conversion <= remaining pretax ---
let convRows = 0;
for (const { label, hh } of archetypes()) {
  for (const mode of ["fillBracket", "recommended"] as const) {
    const A = toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: true, convMode: mode }, DEFAULT_INPUTS) as any;
    const p = projectLifetime({ ...hh, annualSpending: hh.annualSpending * 1.6 }, A); // stress spending to force shortfalls
    for (const row of p.rows) {
      if (row.conversion > 0) {
        convRows++;
        chk(!row.shortfall, `${label} ${mode} y${row.year}: conversion ${fmt(row.conversion)} in a shortfall year`);
        chk(row.conversion <= row.startBalances.pretax - row.fromPretax + 1, `${label} ${mode} y${row.year}: conversion exceeds remaining pretax`);
      }
    }
  }
}
console.log(`\nconversion rows checked: ${convRows}`);
console.log(bad === 0 ? "CONVERSION checks: ALL PASS" : `CONVERSION checks: ${bad} FAILURES`);
