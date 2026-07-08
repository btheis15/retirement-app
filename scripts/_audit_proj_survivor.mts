/**
 * AUDIT PROBE 5 — Survivor (widow's penalty) transition.
 *  - Happens exactly once, in year olderSpouse.birthYear + firstDeathAge.
 *  - Survivor keeps the LARGER SS benefit (COLA'd, claim-adjusted).
 *  - Filing flips to single from that year (tax recomputed under both statuses).
 *  - Spending steps down by spendingFactor exactly once.
 *  - Single-sentinel household: no transition, files single from year 1.
 *  - Exact-FRA (no rounding) check on the survivor's reassigned benefit: kept
 *    benefit factor must be exactly 1.0 even for fractional-FRA birth years.
 *
 * Run: npx tsx scripts/_audit_proj_survivor.mts
 */
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS, adjustedAnnualBenefit } from "./audit-kit.mts";
import { computeTaxes } from "../lib/tax/engine.ts";
import { fullRetirementAge, ssBenefitFactor } from "../lib/socialSecurity.ts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };
const year = new Date().getFullYear();

// Pre-tax-only couple, no dividends → SS income is exactly netCash − draws + taxNoConv.
// Self older (dies), spouse survives with the larger check.
function couple(selfSS: number, spouseSS: number): any {
  return {
    self: { label: "A", birthYear: year - 70, socialSecurityAnnual: selfSS, ssClaimAge: 67 },
    spouse: { label: "B", birthYear: year - 62, socialSecurityAnnual: spouseSS, ssClaimAge: 67 },
    pensionAnnual: 0, annualSpending: 100_000, brokerageDividendsAnnual: 0, state: "IL",
    accounts: [
      { id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 1_500_000 },
      { id: "p2", label: "", kind: "traditional_ira", owner: "spouse", balance: 500_000 },
      { id: "r", label: "", kind: "roth_ira", owner: "spouse", balance: 300_000 },
    ],
  };
}

const hh = couple(48_000, 30_000);
const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...DEFAULT_INPUTS, survivor: { firstDeathAge: 85, spendingFactor: 0.8 } }, {}) as any;
const p = projectLifetime(hh, A);

const expDeathYear = hh.self.birthYear + 85; // self is older
chk(p.survivorYear === expDeathYear, `survivorYear ${p.survivorYear} want ${expDeathYear}`);

// Spending (real) steps down 0.8 exactly once, at the transition year.
const real = p.rows.map((r: any) => r.spendingTarget / r.inflationFactor);
let drops = 0;
for (let i = 1; i < real.length; i++) {
  if (real[i] < real[i - 1] - 1) {
    drops++;
    chk(p.rows[i].year === expDeathYear, `spending drop at ${p.rows[i].year}, want ${expDeathYear}`);
    chk(Math.abs(real[i] / real[i - 1] - 0.8) < 1e-6, `drop factor ${(real[i] / real[i - 1]).toFixed(4)} want 0.8`);
  }
}
chk(drops === 1, `expected exactly 1 spending step-down, saw ${drops}`);

// SS income by row: netCash − draws + taxNoConv. taxNoConv == row.tax here (no conversions).
const ssIncome = (r: any) => r.netCash - (r.fromPretax + r.fromTaxable + r.fromRoth) + r.tax;
const iTrans = p.rows.findIndex((r: any) => r.year === expDeathYear);
const infl = (i: number) => Math.pow(1.025, i);
// Before: both benefits, COLA'd (both claimed at 67; both past claim age by transition; self claimed already at start? age 70 >= 67 yes; spouse 62 < 67 claims in year+5)
const iBefore = iTrans - 1;
const selfAdj = adjustedAnnualBenefit(48_000, hh.self.birthYear, 67); // born 1956: FRA 66.33, claim 67 → +5.33%
const spouseAdj = adjustedAnnualBenefit(30_000, hh.spouse.birthYear, 67); // born 1964: FRA 67 → ×1
const expBefore = (selfAdj + spouseAdj) * infl(iBefore);
chk(Math.abs(ssIncome(p.rows[iBefore]) - expBefore) < 2, `SS year before death: ${fmt(ssIncome(p.rows[iBefore]))} want ${fmt(expBefore)}`);
// After: only the larger check survives (COLA'd). Survivor born year-62 → FRA 67 (integer) → no rounding boost.
const expAfter = selfAdj * infl(iTrans);
chk(Math.abs(ssIncome(p.rows[iTrans]) - expAfter) < 2, `SS at transition: ${fmt(ssIncome(p.rows[iTrans]))} want ${fmt(expAfter)} (larger check kept)`);

// Filing status flips to single: recompute the transition-year tax both ways.
const rT: any = p.rows[iTrans];
const mk = (fs: "single" | "mfj", num65: number) =>
  computeTaxes({
    otherOrdinaryIncome: 0, preTaxWithdrawals: rT.fromPretax, socialSecurity: expAfter,
    qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0, ordinaryDividends: 0, taxExemptInterest: 0,
    num65Plus: num65, year: rT.year, state: "IL", inflationFactor: rT.inflationFactor, filingStatus: fs,
    irmaaMagi: p.rows[iTrans - 2]?.magi,
  });
const tSingle = mk("single", 1);
const tMfj = mk("mfj", 2);
chk(Math.abs(rT.tax - tSingle.totalTax) < 2, `transition-year tax ${fmt(rT.tax)} != single recompute ${fmt(tSingle.totalTax)} (mfj would be ${fmt(tMfj.totalTax)})`);
chk(Math.abs(rT.tax - tMfj.totalTax) > 100, "single vs mfj should differ materially here");

// RMDs continue on the SURVIVOR's age after inheriting: spouse born year-62 → RMD start 75.
// After transition (survivor age 77+), RMD factor must match survivor age, not the deceased's.
const iAfter = iTrans + 2;
if (p.rows[iAfter]) {
  const rA: any = p.rows[iAfter];
  const survAge = rA.spouseAge; // spouse is survivor
  const { uniformLifetimeFactor } = await import("../lib/tax/constants.ts");
  const expRmd = rA.startBalances.pretax / uniformLifetimeFactor(survAge);
  chk(Math.abs(rA.rmd - expRmd) < 1, `post-transition RMD ${fmt(rA.rmd)} want pretax/factor(survivor ${survAge}) = ${fmt(expRmd)}`);
}

// Single-sentinel household: never transitions; files single from year 1.
const single: any = { ...hh, spouse: { label: "none", birthYear: 1900, socialSecurityAnnual: 0, ssClaimAge: 67 }, accounts: [{ id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 1_500_000 }] };
const ps = projectLifetime(single, A);
chk(ps.survivorYear === 0, `single household survivorYear ${ps.survivorYear} want 0`);
const realS = ps.rows.map((r: any) => r.spendingTarget / r.inflationFactor);
chk(realS.every((v: number, i: number) => i === 0 || v >= realS[i - 1] - 1), "single household: no spending step-down");
const r0: any = ps.rows[0];
const ss0 = adjustedAnnualBenefit(48_000, single.self.birthYear, 67); // born 1956, claim 67 → +5.33%
const t0single = computeTaxes({ otherOrdinaryIncome: 0, preTaxWithdrawals: r0.fromPretax, socialSecurity: ss0, qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0, ordinaryDividends: 0, taxExemptInterest: 0, num65Plus: 1, year: r0.year, state: "IL", inflationFactor: 1, filingStatus: "single" });
chk(Math.abs(r0.tax - t0single.totalTax) < 2, `single household year-1 tax ${fmt(r0.tax)} != single recompute ${fmt(t0single.totalTax)}`);

// FRA-rounding (FIXED): survivor born 1957 (FRA 66.5). The transition now assigns
// the EXACT fractional FRA as ssClaimAge, so the kept benefit's claim factor is
// exactly 1.0 — no rounding drift (round(66.5)=67 used to add ~+4% for life).
const hh2 = couple(48_000, 30_000);
hh2.spouse.birthYear = 1957; // survivor
const p2 = projectLifetime(hh2, A);
const iT2 = p2.rows.findIndex((r: any) => r.year === hh2.self.birthYear + 85);
const roundedFactor = ssBenefitFactor(1957, Math.round(fullRetirementAge(1957))); // the old bug's factor, for context
const exactFactor = ssBenefitFactor(1957, fullRetirementAge(1957));
chk(Math.abs(exactFactor - 1) < 1e-9, `claim factor at exact FRA must be 1.0, got ${exactFactor}`);
const got = ssIncome(p2.rows[iT2]);
const expNeutral = adjustedAnnualBenefit(48_000, hh2.self.birthYear, 67) * infl(iT2); // deceased's actual check, COLA'd
chk(Math.abs(got - expNeutral) < 2, `survivor SS at transition ${fmt(got)} must equal the kept check ${fmt(expNeutral)} (factor 1.0)`);
console.log(`FRA-rounding: survivor born 1957 → exact-FRA factor ${exactFactor.toFixed(4)} (rounded-FRA would be ${roundedFactor.toFixed(4)}); SS at transition ${fmt(got)} vs neutral ${fmt(expNeutral)} (drift ${(100 * (got / expNeutral - 1)).toFixed(2)}%)`);

console.log(bad === 0 ? "\nSURVIVOR checks: ALL PASS" : `\nSURVIVOR checks: ${bad} FAILURES`);
