/**
 * AUDIT PROBE 11+12 — recommendPlan grid/scoring + spending sweep/solver sanity.
 *  - Apples-to-apples: ranked candidates all share spending path & assumptions;
 *    ranked[0] maximizes the stated goal score over the grid (vs exhaustive space).
 *  - Stage-2 window search: never regresses the goal, CAN shorten the window
 *    (fixed candidate set 68/70/73/75/80), no in-set window beats the pick.
 *  - spendingSweep: sustainableMax re-projects with no depletion at the haircut
 *    rate; the next grid step above does deplete; depletion monotone in spend.
 *  - goals.ts taxPct denominator: show conversion-tax asymmetry.
 *
 * Run: npx tsx scripts/_audit_proj_goals_sweep.mts
 */
import { recommendPlan, projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS, archetypes, exhaustiveBest, grossIncome } from "./audit-kit.mts";
import { spendingSweep, SWEEP_DOWNSIDE_HAIRCUT } from "../lib/spendingSweep.ts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };

const score = (goal: string, m: any) => {
  if (m.depleted) return -1e12 + m.solventYears;
  if (goal === "maxCapital") return m.netWealth;
  if (goal === "lowestTax") return -m.lifetimeTax;
  return -(m.taxPct * 1e9 + m.lifetimeIrmaa);
};

// --- ranking consistency + grid vs exhaustive space ---
for (const { label, hh } of archetypes().filter((_, i) => [0, 3, 8, 9, 11].includes(i))) {
  for (const goal of ["maxCapital", "lowestTax", "lowestRate"] as const) {
    const rec = recommendPlan(hh, DEFAULT_INPUTS as any, goal, { searchWindow: false, optimizeClaimAge: false });
    // ranked[0] must have the max score among ranked (allowing the documented 2% robust tie-break for maxCapital)
    const scores = rec.ranked.map((c) => score(goal, c.metrics));
    const top = Math.max(...scores);
    const s0 = score(goal, rec.ranked[0].metrics);
    if (goal === "maxCapital" && !rec.ranked[0].metrics.depleted) {
      chk(top - s0 <= Math.abs(top) * 0.02 + 1, `${label}/${goal}: winner ${fmt(s0)} beyond 2% tie-break band of ${fmt(top)}`);
    } else {
      chk(s0 >= top - 1e-9, `${label}/${goal}: ranked[0] not max score (${s0} vs ${top})`);
    }
    // exhaustive space check: shipped grid covers the same config space
    const ex = exhaustiveBest(hh, goal, DEFAULT_INPUTS);
    const exScore = ex.best.score;
    const gap = exScore - s0;
    const rel = Math.abs(exScore) > 1 ? gap / Math.abs(exScore) : gap;
    if (goal === "maxCapital") {
      chk(rel <= 0.021, `${label}/${goal}: exhaustive best ${fmt(exScore)} beats shipped ${fmt(s0)} by ${(rel * 100).toFixed(2)}%`);
    } else {
      chk(gap <= Math.abs(exScore) * 1e-6 + 1, `${label}/${goal}: exhaustive ${exScore} beats shipped ${s0}`);
    }
  }
}

// --- stage-2 window search (FIXED): candidate set now includes SHORTER windows
//     (68/70/73/75/80/firstDeath-1, >= current age). Verify:
//     (a) searchWindow:true never scores worse than searchWindow:false;
//     (b) no window IN the shipped candidate set beats the shipped choice
//         (an off-grid finer window may still win slightly — note, not a bug);
//     (c) at least one household actually SHORTENS its window (< entered 75).
{
  let offGrid = 0, shortened = 0;
  for (const { label, hh } of archetypes()) {
    for (const goal of ["maxCapital", "lowestTax"] as const) {
      const recOn = recommendPlan(hh, DEFAULT_INPUTS as any, goal, { searchWindow: true, optimizeClaimAge: false });
      const recOff = recommendPlan(hh, DEFAULT_INPUTS as any, goal, { searchWindow: false, optimizeClaimAge: false });
      chk(score(goal, recOn.best.metrics) >= score(goal, recOff.best.metrics) - 1e-6,
        `${label}/${goal}: window search REGRESSED the goal (${score(goal, recOn.best.metrics)} < ${score(goal, recOff.best.metrics)})`);
      if (!recOn.best.config.useConversions) continue;
      if (recOn.chosenConvertUntilAge < DEFAULT_INPUTS.convertUntilAge) shortened++;
      const base = { strategy: recOn.best.config.strategy, bracketTarget: recOn.best.config.bracketTarget, conv: true, convMode: recOn.best.config.convertMode };
      const chosenScore = score(goal, recOn.best.metrics);
      const selfAgeNow = new Date().getFullYear() - hh.self.birthYear;
      const inSet = (w: number) => [DEFAULT_INPUTS.convertUntilAge, 68, 70, 73, 75, 80, (DEFAULT_INPUTS.survivor?.firstDeathAge ?? 1) - 1].includes(w);
      for (const w of [66, 68, 70, 72]) {
        if (w === recOn.chosenConvertUntilAge || w < selfAgeNow) continue;
        const p = projectLifetime(hh, toAssumptions(base, { ...DEFAULT_INPUTS, convertUntilAge: w }) as any);
        const m = {
          netWealth: p.endingEstateAfterTax, lifetimeTax: p.lifetimeTax, depleted: p.depleted, solventYears: p.solventYears,
          taxPct: grossIncome(p) > 0 ? p.lifetimeTax / grossIncome(p) : 0, lifetimeIrmaa: p.lifetimeIrmaa,
        };
        const s = score(goal, m);
        if (s > chosenScore + Math.abs(chosenScore) * 0.001 + 100) {
          if (inSet(w)) {
            chk(false, `${label}/${goal}: IN-SET window ${w} scores ${fmt(s)} but shipped chose ${recOn.chosenConvertUntilAge} at ${fmt(chosenScore)}`);
          } else {
            offGrid++;
            if (offGrid <= 6) console.log(`note ${label}/${goal}: off-grid window ${w} scores ${fmt(s)} vs shipped (until ${recOn.chosenConvertUntilAge}) ${fmt(chosenScore)} — grid granularity, not a regression`);
          }
        }
      }
    }
  }
  chk(shortened > 0, "window search never shortened any household's window (fix should allow it)");
  console.log(`window search: households shortened below entered 75: ${shortened}; off-grid finer-window wins: ${offGrid}`);
}

// --- taxPct denominator (FIXED): conversion income now IN the gross-income base ---
{
  const hh = archetypes()[8].hh; // mostly pre-tax
  const pNo = projectLifetime(hh, toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, DEFAULT_INPUTS) as any);
  const pConv = projectLifetime(hh, toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: true, convMode: "fillBracket" }, DEFAULT_INPUTS) as any);
  const giNo = grossIncome(pNo), giConv = grossIncome(pConv);
  const sumConv = pConv.rows.reduce((s: number, r: any) => s + r.conversion, 0);
  chk(Math.abs(sumConv - pConv.totalConverted) < 1, "Σ row.conversion = totalConverted");
  const giConvOld = giConv - sumConv; // pre-fix denominator for context
  console.log(`taxPct denominator: no-conv gross ${fmt(giNo)} vs conv gross ${fmt(giConv)} (converted ${fmt(pConv.totalConverted)} now IN the denominator; pre-fix it was ${fmt(giConvOld)})`);
  console.log(`  taxPct no-conv ${(100 * pNo.lifetimeTax / giNo).toFixed(2)}% vs conv ${(100 * pConv.lifetimeTax / giConv).toFixed(2)}% (pre-fix conv read ${(100 * pConv.lifetimeTax / giConvOld).toFixed(2)}%)`);
}

// --- spending sweep verification ---
for (const { label, hh } of archetypes().filter((_, i) => [0, 3, 5].includes(i))) {
  const A = toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false }, DEFAULT_INPUTS) as any;
  const sw = spendingSweep(hh, A, 400_000, 24);
  // depletion monotone in spend over the grid
  let seenDepleted = false;
  for (const pt of sw.points) {
    if (seenDepleted) chk(pt.depleted, `${label}: non-monotone depletion at spend ${fmt(pt.spend)}`);
    if (pt.depleted) seenDepleted = true;
  }
  // sustainableMax survives at the haircut rate
  const haircut = { ...A, convert: null, returnRate: Math.max(0, A.returnRate - SWEEP_DOWNSIDE_HAIRCUT), returnFor: null };
  const pAt = projectLifetime({ ...hh, annualSpending: sw.sustainableMax }, haircut);
  chk(!pAt.depleted, `${label}: sustainableMax ${fmt(sw.sustainableMax)} depletes on re-projection`);
  const step = 400_000 / 24;
  if (sw.sustainableMax + step <= 400_000) {
    const pAbove = projectLifetime({ ...hh, annualSpending: sw.sustainableMax + step }, haircut);
    chk(pAbove.depleted || sw.sustainableMax === 400_000, `${label}: spend one step above sustainableMax does NOT deplete (grid coarse?)`);
  }
  console.log(`${label}: sustainableMax ${fmt(sw.sustainableMax)}, comfortableMax ${fmt(sw.comfortableMax)}`);
}
console.log(bad === 0 ? "\nGOALS+SWEEP checks: ALL PASS (see notes)" : `\nGOALS+SWEEP checks: ${bad} FAILURES`);
