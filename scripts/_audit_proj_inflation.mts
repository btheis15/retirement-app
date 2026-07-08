/**
 * AUDIT PROBE 6 — Inflation indexing, real outputs, Guyton-Klinger guardrails.
 *  - constant: spendingTarget[t] = W0 × inflationFactor[t] exactly.
 *  - flatNominal: spendingTarget constant.
 *  - inflationFactor[t] = (1+i)^t (and matches a stochastic inflationFor path).
 *  - lifetimeTaxReal / lifetimeIrmaaReal = Σ row/row.inflationFactor.
 *  - endingEstateReal = endingEstate / Π(1+infl over ALL modeled years).
 *  - Guardrails: replicate the GK rules row-by-row against the engine.
 *
 * Run: npx tsx scripts/_audit_proj_inflation.mts
 */
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS, DEMO_HOUSEHOLD } from "./audit-kit.mts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };
const hh = { ...DEMO_HOUSEHOLD, accounts: DEMO_HOUSEHOLD.accounts.map((a) => ({ ...a, holdings: undefined })) };

// --- constant real spending + price level ---
{
  const p = projectLifetime(hh, toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false }, { ...DEFAULT_INPUTS, survivor: null }) as any);
  p.rows.forEach((r: any, i: number) => {
    chk(Math.abs(r.inflationFactor - Math.pow(1.025, i)) < 1e-9, `factor y${i}: ${r.inflationFactor} want ${Math.pow(1.025, i)}`);
    chk(Math.abs(r.spendingTarget - 180_000 * Math.pow(1.025, i)) < 0.01, `constant target y${i}: ${fmt(r.spendingTarget)} want ${fmt(180_000 * Math.pow(1.025, i))}`);
  });
  const taxReal = p.rows.reduce((s: number, r: any) => s + r.tax / r.inflationFactor, 0);
  chk(Math.abs(taxReal - p.lifetimeTaxReal) < 1, "lifetimeTaxReal = Σ tax/factor");
  const irmaaReal = p.rows.reduce((s: number, r: any) => s + r.irmaa / r.inflationFactor, 0);
  chk(Math.abs(irmaaReal - p.lifetimeIrmaaReal) < 1, "lifetimeIrmaaReal = Σ irmaa/factor");
  const endDefl = Math.pow(1.025, p.rows.length); // price level AFTER the last modeled year
  chk(Math.abs(p.endingEstateReal - p.endingEstate / endDefl) < 1, `endingEstateReal ${fmt(p.endingEstateReal)} want ${fmt(p.endingEstate / endDefl)}`);
  chk(Math.abs(p.endingEstateAfterTaxReal - p.endingEstateAfterTax / endDefl) < 1, "afterTaxReal deflated by end price level");
}
// --- flatNominal ---
{
  const p = projectLifetime(hh, toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false, spendingStrategy: "flatNominal" }, { ...DEFAULT_INPUTS, survivor: null }) as any);
  chk(p.rows.every((r: any) => Math.abs(r.spendingTarget - 180_000) < 0.01), "flatNominal target constant");
}
// --- stochastic inflationFor drives everything together ---
{
  const path = (i: number) => 0.02 + 0.015 * Math.sin(i * 1.7); // deterministic pseudo-path
  const p = projectLifetime(hh, toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false }, { ...DEFAULT_INPUTS, survivor: null }, { inflationFor: path }) as any);
  let lvl = 1;
  p.rows.forEach((r: any, i: number) => {
    chk(Math.abs(r.inflationFactor - lvl) < 1e-9, `stochastic factor y${i}`);
    chk(Math.abs(r.spendingTarget - 180_000 * lvl) < 0.01, `stochastic target y${i}`);
    lvl *= 1 + path(i);
  });
  chk(Math.abs(p.endingEstateReal - p.endingEstate / lvl) < 1, "stochastic end deflator = final price level");
}
// --- Guyton-Klinger replication ---
{
  const rf = (i: number) => (i % 7 === 3 ? -0.12 : 0.07); // periodic crashes
  const A = toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false, spendingStrategy: "guardrails" }, { ...DEFAULT_INPUTS, survivor: null }, { returnFor: rf }) as any;
  const p = projectLifetime(hh, A);
  const W0 = 180_000;
  const P0 = hh.accounts.reduce((s, a) => s + a.balance, 0);
  const endAge = 95;
  let spend = W0;
  p.rows.forEach((r: any, i: number) => {
    chk(Math.abs(r.spendingTarget - spend) < 0.01, `GK y${i}: target ${fmt(r.spendingTarget)} want ${fmt(spend)}`);
    // advance per GK rules (refSpend = W0, no survivor)
    const portfolio = r.endTotal;
    const lastReturn = rf(i);
    const inflation = 0.025;
    const yearsLeft = endAge - r.selfAge;
    if (portfolio <= 0 || P0 <= 0) spend = spend * (1 + inflation);
    else {
      const initWR = W0 / P0;
      let s2 = spend * (1 + inflation);
      if (lastReturn < 0 && s2 / portfolio > initWR) s2 = spend;
      const wr = s2 / portfolio;
      if (yearsLeft > 15 && wr > 1.2 * initWR) s2 *= 0.9;
      else if (wr < 0.8 * initWR) s2 *= 1.1;
      spend = s2;
    }
  });
  // minRealSpendRatio consistency
  const minRatio = Math.min(...p.rows.map((r: any) => r.spendingTarget / r.inflationFactor / W0));
  chk(Math.abs(p.minRealSpendRatio - Math.min(1, minRatio)) < 1e-9, `minRealSpendRatio ${p.minRealSpendRatio} want ${Math.min(1, minRatio)}`);
  console.log(`GK: min real spend ratio ${p.minRealSpendRatio.toFixed(3)} (cuts fired: ${p.rows.filter((r: any, i: number) => i > 0 && r.spendingTarget < p.rows[i - 1].spendingTarget).length})`);
}
console.log(bad === 0 ? "\nINFLATION/GK checks: ALL PASS" : `\nINFLATION/GK checks: ${bad} FAILURES`);
