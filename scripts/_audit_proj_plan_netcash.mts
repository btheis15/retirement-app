/**
 * AUDIT PROBE 2 — Spending target met + gross-up correctness.
 *
 * For every projection row of several archetypes/configs:
 *  (a) when not in shortfall, netCash ≈ spendingTarget (bisection tolerance) OR
 *      netCash > target only because fixed income/RMD already exceeds it;
 *  (b) recompute taxes independently via computeTaxes on the row's withdrawals
 *      and confirm netCash = withdrawals + SS + pension (+ divs if spend mode)
 *      − tax(no conversion), and row.tax = tax(with conversion stacked on top).
 *
 * Run: npx tsx scripts/_audit_proj_plan_netcash.mts
 */
import { planYear } from "../lib/optimizer.ts";
import { computeTaxes } from "../lib/tax/engine.ts";
import { bucketOf, ageInYear } from "../lib/accounts.ts";
import { adjustedAnnualBenefit } from "../lib/socialSecurity.ts";
import { archetypes, fmt } from "./audit-kit.mts";

let checked = 0, bad = 0;
const year = new Date().getFullYear();

for (const { label, hh } of archetypes()) {
  for (const strategy of ["smart", "conventional", "proportional"] as const) {
    for (const conv of [null, { mode: "fillBracket", toBracket: 0.24 } as any, { mode: "recommended", futureRate: 0.30 } as any]) {
      for (const dividendMode of ["reinvest", "spend"] as const) {
        for (const yOff of [0, 5, 15, 30]) {
          const y = year + yOff;
          const f = Math.pow(1.025, yOff);
          const isSingle = !(hh.spouse && hh.spouse.birthYear > 1900);
          const fs = isSingle ? ("single" as const) : ("mfj" as const);
          // build the household as-of "now" (accounts unchanged — single-year planner semantics)
          const plan = planYear(hh, { strategy, bracketTarget: 0.22, year: y, conversion: conv, inflationFactor: f, dividendMode, filingStatus: fs });
          checked++;

          // ---- independent tax recompute ----
          const selfAge = ageInYear(hh.self.birthYear, y);
          const spouseAge = ageInYear(hh.spouse.birthYear, y);
          const num65 = isSingle ? (Math.min(selfAge, spouseAge) >= 65 ? 1 : 0) : (selfAge >= 65 ? 1 : 0) + (spouseAge >= 65 ? 1 : 0);
          const ss =
            (selfAge >= hh.self.ssClaimAge ? adjustedAnnualBenefit(hh.self.socialSecurityAnnual, hh.self.birthYear, hh.self.ssClaimAge) : 0) +
            (spouseAge >= hh.spouse.ssClaimAge ? adjustedAnnualBenefit(hh.spouse.socialSecurityAnnual, hh.spouse.birthYear, hh.spouse.ssClaimAge) : 0);
          const taxAccts = hh.accounts.filter((a) => bucketOf(a.kind) === "taxable");
          const cash = taxAccts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
          const brk = taxAccts.filter((a) => a.kind !== "cash");
          const brkBal = brk.reduce((s, a) => s + a.balance, 0);
          const brkGain = brk.reduce((s, a) => s + Math.max(0, a.balance - (a.costBasis ?? a.balance)), 0);
          const gainFrac = brkBal > 0 ? Math.min(1, brkGain / brkBal) : 0;
          const ltg = (extraPretax: number) => Math.max(0, plan.withdrawals.taxable - cash) * gainFrac;
          const taxOf = (pretaxDraw: number) =>
            computeTaxes({
              otherOrdinaryIncome: hh.pensionAnnual,
              preTaxWithdrawals: pretaxDraw,
              socialSecurity: ss,
              qualifiedDividends: hh.brokerageDividendsAnnual,
              longTermGains: ltg(0),
              taxableInterest: hh.taxableInterestAnnual ?? 0,
              ordinaryDividends: hh.ordinaryDividendsAnnual ?? 0,
              taxExemptInterest: hh.taxExemptInterestAnnual ?? 0,
              num65Plus: num65,
              year: y,
              state: hh.state ?? "IL",
              inflationFactor: f,
              filingStatus: fs,
            });
          const taxNoConv = taxOf(plan.withdrawals.pretax);
          const taxWithConv = taxOf(plan.withdrawals.pretax + plan.conversion);
          const divInc = hh.brokerageDividendsAnnual + (hh.ordinaryDividendsAnnual ?? 0) + (hh.taxableInterestAnnual ?? 0) + (hh.taxExemptInterestAnnual ?? 0);
          const inflow = ss + hh.pensionAnnual + (dividendMode === "spend" ? divInc : 0) +
            plan.withdrawals.pretax + plan.withdrawals.taxable + plan.withdrawals.roth;
          const expNetCash = inflow - taxNoConv.totalTax;

          const issues: string[] = [];
          if (Math.abs(expNetCash - plan.netCash) > 1) issues.push(`netCash identity off: exp ${fmt(expNetCash)} got ${fmt(plan.netCash)}`);
          if (Math.abs(taxWithConv.totalTax - plan.tax.totalTax) > 1) issues.push(`tax(with conv) off: exp ${fmt(taxWithConv.totalTax)} got ${fmt(plan.tax.totalTax)}`);
          if (plan.conversion > 0 && Math.abs((taxWithConv.totalTax - taxNoConv.totalTax) - plan.conversionTax) > 1)
            issues.push(`conversionTax not marginal stack: exp ${fmt(taxWithConv.totalTax - taxNoConv.totalTax)} got ${fmt(plan.conversionTax)}`);
          // (a) target met
          const totalAssets = hh.accounts.reduce((s, a) => s + a.balance, 0);
          if (plan.shortfall <= 1) {
            const over = plan.netCash - plan.spendingTarget;
            // overshoot legitimate only if zero voluntary draws possible below (RMD/fixed income already covers)
            const draws = plan.withdrawals.pretax + plan.withdrawals.taxable + plan.withdrawals.roth;
            const forcedOnly = Math.abs(draws - Math.min(plan.rmd, /*pretax*/ hh.accounts.filter((a)=>bucketOf(a.kind)==="pretax").reduce((s,a)=>s+a.balance,0))) < 1;
            if (over > 5 && !forcedOnly) issues.push(`overshoot ${fmt(over)} with voluntary draws (target ${fmt(plan.spendingTarget)})`);
            if (over < -1) issues.push(`undershoot ${fmt(over)} but shortfall=${plan.shortfall}`);
          } else {
            // shortfall must equal target - netCash and all buckets exhausted
            if (Math.abs(plan.shortfall - (plan.spendingTarget - plan.netCash)) > 1) issues.push("shortfall != target - netCash");
          }
          if (issues.length) {
            bad++;
            if (bad <= 15) console.log(`ISSUE ${label} | ${strategy} | conv=${conv?.mode ?? "none"} | ${dividendMode} | y+${yOff}: ${issues.join("; ")}`);
          }
        }
      }
    }
  }
}
console.log(`\nChecked ${checked} planYear calls; ${bad} with issues.`);
