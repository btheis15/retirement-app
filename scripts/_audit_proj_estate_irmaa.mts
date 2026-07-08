/**
 * AUDIT PROBE 8+9 — Ending estate math and IRMAA lookback.
 *  Estate: endingEstateAfterTax = pretax×(1−heirTax) + roth + taxable (step-up);
 *          netWealthRobust = afterTax − 0.15×taxableGain; real = /end price level.
 *  IRMAA: row T surcharge = tier(magi[T−2]) × 12 × enrollees, tiers scaled by
 *         year-T inflationFactor; first two years fall back to same-year MAGI
 *         EXCLUDING any conversion (no double-billing early conversions);
 *         zero before Medicare age; single tiers after survivor transition.
 *
 * Run: npx tsx scripts/_audit_proj_estate_irmaa.mts
 */
import { projectLifetime, recommendPlan, fmt, toAssumptions, DEFAULT_INPUTS, archetypes } from "./audit-kit.mts";
import { IRMAA_TIERS_MFJ, IRMAA_TIERS_SINGLE } from "../lib/tax/constants.ts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };

function irmaaLookup(magi: number, tiers: any[], f: number, enrollees: number) {
  if (enrollees <= 0) return 0;
  for (const t of tiers) if (magi <= t.upTo * f) return t.monthlyPerPerson * 12 * enrollees;
  return tiers[tiers.length - 1].monthlyPerPerson * 12 * enrollees;
}

for (const { label, hh } of archetypes()) {
  for (const conv of [false, true]) {
    const A = toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv, convMode: "fillBracket" }, DEFAULT_INPUTS) as any;
    const p = projectLifetime(hh, A);
    // --- estate identities ---
    const b = p.endingBuckets;
    const expAfter = Math.max(0, b.pretax * (1 - 0.24) + b.roth + b.taxable);
    chk(Math.abs(p.endingEstateAfterTax - expAfter) < 1, `${label} conv=${conv}: afterTax ${fmt(p.endingEstateAfterTax)} want ${fmt(expAfter)}`);
    chk(Math.abs(p.endingEstate - (b.pretax + b.roth + b.taxable)) < 1, `${label}: endingEstate = sum of buckets`);
    const endDefl = Math.pow(1.025, p.rows.length);
    chk(Math.abs(p.endingEstateReal - p.endingEstate / endDefl) < 1, `${label}: estateReal deflator`);
    chk(b.taxableGain >= -0.01 && b.taxableGain <= b.taxable + 0.01, `${label}: 0 <= taxableGain <= taxable`);

    // --- IRMAA lookback, tier indexation, enrollees ---
    const isSingle = !(hh.spouse && hh.spouse.birthYear > 1900);
    const survYear = p.survivorYear;
    for (let i = 0; i < p.rows.length; i++) {
      const r: any = p.rows[i];
      const single = isSingle || (survYear > 0 && r.year >= survYear);
      const tiers = single ? IRMAA_TIERS_SINGLE : IRMAA_TIERS_MFJ;
      const n65 = single
        ? (Math.min(r.selfAge, r.spouseAge) >= 65 ? 1 : 0)
        : (r.selfAge >= 65 ? 1 : 0) + (r.spouseAge >= 65 ? 1 : 0);
      // 2-year lookback; the first 2 (fallback) years price same-year MAGI but
      // EXCLUDING any Roth conversion (fixed: a conversion can't have raised the
      // premium that was set by pre-projection income, and pricing it here
      // double-billed it once the real lookback kicked in). At conversion-scale
      // MAGI the SS-taxability cap is binding, so pre-conversion MAGI = magi − conversion.
      const magiRef = i >= 2 ? p.rows[i - 2].magi : r.magi - (r.conversion ?? 0);
      const exp = irmaaLookup(magiRef, tiers, r.inflationFactor, n65);
      chk(Math.abs(r.irmaa - exp) < 0.5, `${label} conv=${conv} y${i} (${r.year}): irmaa ${fmt(r.irmaa)} want ${fmt(exp)} (magiRef ${fmt(magiRef)}, n65 ${n65}, single ${single})`);
      if (n65 === 0) chk(r.irmaa === 0, `${label} y${i}: IRMAA charged before Medicare age`);
    }
    // lifetime sum
    const sum = p.rows.reduce((s: number, r: any) => s + r.irmaa, 0);
    chk(Math.abs(sum - p.lifetimeIrmaa) < 1, `${label}: lifetimeIrmaa = Σ rows`);
  }
}
// netWealthRobust identity via recommendPlan metrics
{
  const rec = recommendPlan(archetypes()[0].hh, DEFAULT_INPUTS as any, "maxCapital", { optimizeClaimAge: false, searchWindow: false });
  for (const c of rec.ranked.slice(0, 5)) {
    const exp = Math.max(0, c.projection.endingEstateAfterTax - c.projection.endingBuckets.taxableGain * 0.15);
    chk(Math.abs(c.metrics.netWealthRobust - exp) < 1, `robust metric: ${fmt(c.metrics.netWealthRobust)} want ${fmt(exp)}`);
  }
}
console.log(bad === 0 ? "ESTATE+IRMAA checks: ALL PASS" : `ESTATE+IRMAA checks: ${bad} FAILURES`);
