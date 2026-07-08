/**
 * AUDIT PROBE 1 — Money conservation.
 *
 * Clean-room replica of the projection year-loop, written from DOCS.md's stated
 * ordering (draw → convert → IRMAA → grow → carve-out → advance). It reuses
 * planYear (the flows) but re-implements ALL account mechanics independently,
 * then compares every row of projectLifetime against the replica:
 *   endBalances = startBalances − withdrawals − conversionTaxPaid(from cash)
 *                 − irmaaFromSavings + reinvestedSurplus + growth − dividendCarveOut
 *                 (+ in reinvest mode: cash-interest credit and retained-dividend
 *                  basis step-up, mirroring the fixed engine)
 * Any divergence > $1 in any year = a conservation leak.
 *
 * Run: npx tsx scripts/_audit_proj_conservation.mts
 */
import { projectLifetime } from "../lib/projection.ts";
import { planYear } from "../lib/optimizer.ts";
import { bucketOf } from "../lib/accounts.ts";
import { adjustedAnnualBenefit, fullRetirementAge } from "../lib/socialSecurity.ts";
import { dividendBreakdown, bucketGrowthFactor } from "../lib/dividends.ts";
import { archetypes, DEFAULT_INPUTS, toAssumptions, fmt, DEMO_HOUSEHOLD } from "./audit-kit.mts";

// ---------- independent account mechanics (from DOCS spec) ----------
function drawBucket(accounts: any[], bucket: string, amount: number) {
  if (amount <= 0) return;
  const inB = accounts.filter((a) => bucketOf(a.kind) === bucket);
  const total = inB.reduce((s, a) => s + a.balance, 0);
  if (total <= 0) return;
  if (bucket === "taxable") {
    let rem = amount;
    for (const a of inB.filter((x) => x.kind === "cash")) {
      if (rem <= 0) break;
      if (a.balance <= 0) continue;
      const take = Math.min(a.balance, rem);
      if (a.costBasis != null) a.costBasis *= 1 - take / a.balance;
      a.balance -= take;
      rem -= take;
    }
    if (rem > 0) {
      const brk = inB.filter((x) => x.kind !== "cash");
      const bt = brk.reduce((s, a) => s + a.balance, 0);
      if (bt > 0) {
        const ratio = Math.min(1, rem / bt);
        for (const a of brk) {
          if (a.balance <= 0) continue;
          const take = a.balance * ratio;
          if (a.costBasis != null) a.costBasis *= 1 - take / a.balance;
          a.balance -= take;
        }
      }
    }
    return;
  }
  const ratio = Math.min(1, amount / total);
  for (const a of inB) {
    if (a.balance <= 0) continue;
    a.balance -= a.balance * ratio;
  }
}
function payTaxFromCash(accounts: any[], amount: number): number {
  if (amount <= 0) return 0;
  let rem = amount;
  for (const a of accounts.filter((x: any) => x.kind === "cash")) {
    if (rem <= 0) break;
    if (a.balance <= 0) continue;
    const take = Math.min(a.balance, rem);
    if (a.costBasis != null) a.costBasis *= 1 - take / a.balance;
    a.balance -= take;
    rem -= take;
  }
  return amount - rem;
}
function creditRoth(accounts: any[], amount: number) {
  if (amount <= 0) return;
  const roths = accounts.filter((a) => bucketOf(a.kind) === "roth").sort((a, b) => b.balance - a.balance);
  if (roths[0]) roths[0].balance += amount;
  else accounts.push({ id: "roth-conv", label: "x", kind: "roth_ira", owner: "self", balance: amount });
}
function reinvest(accounts: any[], amount: number) {
  if (amount <= 0) return;
  // Strictly a BROKERAGE account (never cash) — mirrors the fixed reinvestSurplus.
  let b = accounts.find((a) => a.kind === "brokerage");
  if (!b) {
    b = { id: "sb", label: "x", kind: "brokerage", owner: "self", balance: 0, costBasis: 0 };
    accounts.push(b);
  }
  b.balance += amount;
  b.costBasis = (b.costBasis ?? 0) + amount;
}
function distribute(accounts: any[], amount: number) {
  if (amount <= 0) return;
  const brk = accounts.filter((a) => a.kind !== "cash" && bucketOf(a.kind) === "taxable");
  const total = brk.reduce((s, a) => s + a.balance, 0);
  if (total <= 0) return;
  const ratio = Math.min(1, amount / total);
  for (const a of brk) a.balance -= a.balance * ratio;
}
const sumB = (accts: any[], bucket: string) => accts.filter((a) => bucketOf(a.kind) === bucket).reduce((s, a) => s + a.balance, 0);

// ---------- replica projection ----------
function replica(household: any, A: any) {
  const h = {
    ...household,
    self: { ...household.self },
    spouse: { ...household.spouse },
    accounts: household.accounts.map((a: any) => ({ ...a })),
  };
  const isSingle = !(household.spouse && household.spouse.birthYear > 1900);
  const startYear = new Date().getFullYear();
  const rows: any[] = [];
  const olderWho = h.self.birthYear <= h.spouse.birthYear ? "self" : "spouse";
  const survivorWho = olderWho === "self" ? "spouse" : "self";
  const firstDeathYear = A.survivor ? h[olderWho].birthYear + A.survivor.firstDeathAge : Infinity;
  let applied = false;
  const magiByYear = new Map<number, number>();
  const isBrk = (a: any) => a.kind !== "cash" && bucketOf(a.kind) === "taxable";
  const taxableHoldings = h.accounts.filter((a: any) => bucketOf(a.kind) === "taxable").flatMap((a: any) => a.holdings ?? []);
  const divModel = dividendBreakdown(taxableHoldings);
  const useDivModel = divModel.hasData;
  const qualFactor: number[] = [];
  const ordFactor: number[] = [];
  if (useDivModel) for (let t = 0; t < 62; t++) { qualFactor.push(bucketGrowthFactor(taxableHoldings, "qualified", t)); ordFactor.push(bucketGrowthFactor(taxableHoldings, "ordinary", t)); }
  let shareFraction = 1;
  const brokNow = () => h.accounts.filter(isBrk).reduce((s: number, a: any) => s + a.balance, 0);
  const baseDivQ = useDivModel ? divModel.qualifiedYear0 : household.brokerageDividendsAnnual;
  const baseDivO = useDivModel ? divModel.ordinaryYear0 : (household.ordinaryDividendsAnnual ?? 0);
  const baseInt = household.taxableInterestAnnual ?? 0;
  const baseMuni = household.taxExemptInterestAnnual ?? 0;
  const initBrok = brokNow();
  const initCash = h.accounts.filter((a: any) => a.kind === "cash").reduce((s: number, a: any) => s + a.balance, 0);
  let priceLevel = 1;

  for (let year = startYear; year <= startYear + 60; year++) {
    const selfAge = year - h.self.birthYear;
    const spouseAge = year - h.spouse.birthYear;
    if (selfAge > A.endAge && spouseAge > A.endAge) break;
    const startBalances = { pretax: sumB(h.accounts, "pretax"), roth: sumB(h.accounts, "roth"), taxable: sumB(h.accounts, "taxable") };
    const inflationFactor = priceLevel;
    const curBrok = brokNow();
    const curCash = h.accounts.filter((a: any) => a.kind === "cash").reduce((s: number, a: any) => s + a.balance, 0);
    const divF = initBrok > 0 ? curBrok / initBrok : 1;
    const intF = initCash > 0 ? curCash / initCash : 1;
    if (useDivModel) {
      const t = year - startYear;
      h.brokerageDividendsAnnual = baseDivQ * (qualFactor[t] ?? 1) * shareFraction;
      h.ordinaryDividendsAnnual = baseDivO * (ordFactor[t] ?? 1) * shareFraction;
    } else {
      h.brokerageDividendsAnnual = baseDivQ * divF;
      h.ordinaryDividendsAnnual = baseDivO * divF;
    }
    h.taxExemptInterestAnnual = baseMuni * divF;
    h.taxableInterestAnnual = baseInt * intF;

    const isSurvYear = !isSingle && A.survivor != null && year >= firstDeathYear;
    if (isSurvYear && !applied) {
      applied = true;
      const sb = adjustedAnnualBenefit(h.self.socialSecurityAnnual, h.self.birthYear, h.self.ssClaimAge);
      const pb = adjustedAnnualBenefit(h.spouse.socialSecurityAnnual, h.spouse.birthYear, h.spouse.ssClaimAge);
      const kept = Math.max(sb, pb);
      const sv = h[survivorWho];
      // EXACT fractional FRA (no rounding) — mirrors the fixed survivor transition.
      h[survivorWho] = { ...sv, socialSecurityAnnual: kept, ssClaimAge: fullRetirementAge(sv.birthYear) };
      h[olderWho] = { ...h[olderWho], socialSecurityAnnual: 0 };
      for (const a of h.accounts) if (a.owner === olderWho) a.owner = survivorWho;
      h.annualSpending *= A.survivor.spendingFactor;
    }
    const filingStatus = isSingle || isSurvYear ? "single" : "mfj";
    const convertThisYear = A.convert != null && selfAge <= A.convert.untilAge;
    const conversionParam = !convertThisYear
      ? null
      : A.convert.mode === "recommended"
        ? { mode: "recommended", futureRate: A.futureRateOverride }
        : { mode: "fillBracket", toBracket: A.bracketTarget };
    const plan = planYear(h, {
      strategy: A.strategy, bracketTarget: A.bracketTarget, year,
      conversion: conversionParam as any, inflationFactor, filingStatus: filingStatus as any,
      irmaaMagi: magiByYear.get(year - 2), dividendMode: A.dividendMode,
    });
    magiByYear.set(year, plan.tax.magi);

    drawBucket(h.accounts, "pretax", plan.withdrawals.pretax);
    const brkBefore = useDivModel ? brokNow() : 0;
    drawBucket(h.accounts, "taxable", plan.withdrawals.taxable);
    if (useDivModel && brkBefore > 0) shareFraction *= brokNow() / brkBefore;
    drawBucket(h.accounts, "roth", plan.withdrawals.roth);
    if (plan.conversion > 0) {
      drawBucket(h.accounts, "pretax", plan.conversion);
      const paid = payTaxFromCash(h.accounts, plan.conversionTax);
      creditRoth(h.accounts, Math.max(0, plan.conversion - Math.max(0, plan.conversionTax - paid)));
    }
    const irmaaCost = plan.tax.irmaa.householdAnnual;
    const leftover = plan.netCash - plan.spendingTarget;
    const reinvestAmt = Math.max(0, leftover - irmaaCost);
    const premium = Math.max(0, irmaaCost - Math.max(0, leftover));
    if (reinvestAmt > 0) {
      const b0 = useDivModel ? brokNow() : 0;
      reinvest(h.accounts, reinvestAmt);
      if (useDivModel && b0 > 0) shareFraction *= brokNow() / b0;
    } else if (premium > 0) {
      const b0 = useDivModel ? brokNow() : 0;
      drawBucket(h.accounts, "taxable", premium);
      if (useDivModel && b0 > 0) shareFraction *= brokNow() / b0;
    }
    const rate = A.returnFor ? A.returnFor(year - startYear) : A.returnRate;
    for (const a of h.accounts) if (a.kind !== "cash") a.balance *= 1 + rate;
    if (A.dividendMode === "spend") {
      distribute(h.accounts, (h.brokerageDividendsAnnual ?? 0) + (h.ordinaryDividendsAnnual ?? 0) + (h.taxExemptInterestAnnual ?? 0));
    } else {
      // Reinvest mode (mirrors the fixed engine):
      // (1) credit the taxed cash interest to cash accounts (pro-rata, basis too);
      const interest = h.taxableInterestAnnual ?? 0;
      if (interest > 0) {
        const cashAccts = h.accounts.filter((a: any) => a.kind === "cash");
        const cashTotal = cashAccts.reduce((s: number, a: any) => s + a.balance, 0);
        for (const a of cashAccts) {
          const share = cashTotal > 0 ? a.balance / cashTotal : 1 / Math.max(1, cashAccts.length);
          a.balance += interest * share;
          if (a.costBasis != null) a.costBasis += interest * share;
        }
      }
      // (2) step up brokerage cost basis by retained dividends/muni (capped at balance).
      const retained = (h.brokerageDividendsAnnual ?? 0) + (h.ordinaryDividendsAnnual ?? 0) + (h.taxExemptInterestAnnual ?? 0);
      if (retained > 0) {
        const brk = h.accounts.filter((a: any) => a.kind !== "cash" && bucketOf(a.kind) === "taxable");
        const brkTotal = brk.reduce((s: number, a: any) => s + a.balance, 0);
        if (brkTotal > 0) {
          for (const a of brk) {
            a.costBasis = Math.min(a.balance, (a.costBasis ?? 0) + retained * (a.balance / brkTotal));
          }
        }
      }
    }
    const endTotal = h.accounts.reduce((s: number, a: any) => s + a.balance, 0);
    const minBal = Math.min(...h.accounts.map((a: any) => a.balance));
    rows.push({
      year, rmd: plan.rmd, fromPretax: plan.withdrawals.pretax, fromTaxable: plan.withdrawals.taxable,
      fromRoth: plan.withdrawals.roth, conversion: plan.conversion, tax: plan.tax.totalTax,
      netCash: plan.netCash, spendingTarget: plan.spendingTarget, magi: plan.tax.magi,
      irmaa: irmaaCost, startBalances, endTotal, minBal,
    });
    const yearInfl = A.inflationFor ? A.inflationFor(year - startYear) : A.inflationRate;
    if (A.spendingStrategy === "flatNominal") {
      // no growth
    } else {
      h.annualSpending *= 1 + yearInfl; // (guardrails not replicated here)
    }
    h.self = { ...h.self, socialSecurityAnnual: h.self.socialSecurityAnnual * (1 + yearInfl) };
    h.spouse = { ...h.spouse, socialSecurityAnnual: h.spouse.socialSecurityAnnual * (1 + yearInfl) };
    priceLevel *= 1 + yearInfl;
  }
  return rows;
}

// ---------- compare ----------
let worst = { label: "", field: "", year: 0, diff: 0 };
let failures = 0;
let negBal = 0;

const cases: any[] = [];
for (const { label, hh } of archetypes()) {
  for (const strategy of ["smart", "conventional", "proportional"]) {
    cases.push({ label: `${label} | ${strategy} | no conv | reinvest`, hh, cfg: { strategy, bracketTarget: 0.22, conv: false } , over: {} });
  }
  cases.push({ label: `${label} | smart | fillBracket conv | reinvest`, hh, cfg: { strategy: "smart", bracketTarget: 0.22, conv: true, convMode: "fillBracket" }, over: {} });
  cases.push({ label: `${label} | conventional | conv rec (override) | spend divs`, hh, cfg: { strategy: "conventional", bracketTarget: 0.22, conv: true, convMode: "recommended" }, over: { dividendMode: "spend", futureRateOverride: 0.28 } });
  cases.push({ label: `${label} | smart | no conv | r=0`, hh, cfg: { strategy: "smart", bracketTarget: 0.22, conv: false }, over: { returnRate: 0 } });
}
// demo WITH holdings (useDivModel path)
cases.push({ label: `DEMO(holdings) | smart | fillBracket | reinvest`, hh: DEMO_HOUSEHOLD, cfg: { strategy: "smart", bracketTarget: 0.22, conv: true, convMode: "fillBracket" }, over: {} });
cases.push({ label: `DEMO(holdings) | conventional | no conv | spend divs`, hh: DEMO_HOUSEHOLD, cfg: { strategy: "conventional", bracketTarget: 0.22, conv: false }, over: { dividendMode: "spend" } });

for (const c of cases) {
  const A = toAssumptions(c.cfg, DEFAULT_INPUTS, c.over);
  const p = projectLifetime(c.hh, A as any);
  const r = replica(c.hh, { ...A, futureRateOverride: (c.over as any).futureRateOverride ?? p.futureRate });
  if (p.rows.length !== r.length) {
    console.log(`ROWCOUNT MISMATCH ${c.label}: ${p.rows.length} vs ${r.length}`);
    failures++;
    continue;
  }
  for (let i = 0; i < p.rows.length; i++) {
    const a: any = p.rows[i];
    const b: any = r[i];
    if (b.minBal < -0.01) { negBal++; console.log(`NEGATIVE BALANCE ${c.label} y${b.year}: ${b.minBal}`); }
    for (const f of ["rmd", "fromPretax", "fromTaxable", "fromRoth", "conversion", "tax", "netCash", "spendingTarget", "magi", "irmaa", "endTotal"]) {
      const d = Math.abs((a[f] ?? 0) - (b[f] ?? 0));
      if (d > 1) {
        failures++;
        if (d > worst.diff) worst = { label: c.label, field: f, year: a.year, diff: d };
        if (failures <= 12) console.log(`LEAK ${c.label} y${a.year} ${f}: proj=${fmt(a[f])} replica=${fmt(b[f])} diff=${fmt(d)}`);
      }
    }
    for (const f of ["pretax", "roth", "taxable"]) {
      const d = Math.abs(a.startBalances[f] - b.startBalances[f]);
      if (d > 1) {
        failures++;
        if (failures <= 12) console.log(`LEAK ${c.label} y${a.year} start.${f}: proj=${fmt(a.startBalances[f])} replica=${fmt(b.startBalances[f])} diff=${fmt(d)}`);
      }
    }
  }
}
console.log(`\nCases: ${cases.length}. Field mismatches >$1: ${failures}. Negative balances: ${negBal}.`);
if (failures) console.log(`Worst: ${worst.label} year ${worst.year} ${worst.field} diff ${fmt(worst.diff)}`);
else console.log("CONSERVATION: all rows of all cases match the clean-room replica to <= $1.");
