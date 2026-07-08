/**
 * AUDIT PROBE 13 — Misc dollar-consequence checks.
 *  A) reinvestSurplus (FIXED) with NO brokerage account but existing cash: surplus
 *     now ALWAYS goes to a brokerage (created on demand, never parked in cash), so
 *     a household with/without a $1 brokerage ends within ~$0 (was a $2.15M gap).
 *  B) spendingSolver: solved spend's MC success ≈ target; success(spend) monotone
 *     with the shared seed (small runs for speed, sync fallback in node).
 *
 * Run: npx tsx scripts/_audit_proj_misc.mts
 */
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS } from "./audit-kit.mts";
import { solveSafeSpending } from "../lib/spendingSolver.ts";
import { computeMonteCarlo } from "../lib/mcClient.ts";
import { returnModel } from "../lib/returns.ts";

const year = new Date().getFullYear();

// A) pretax + cash only, low spending → forced RMD surplus every year
{
  const mk = (withBrokerage: boolean): any => ({
    self: { label: "A", birthYear: year - 75, socialSecurityAnnual: 40_000, ssClaimAge: 67 },
    spouse: { label: "B", birthYear: year - 75, socialSecurityAnnual: 25_000, ssClaimAge: 67 },
    pensionAnnual: 0, annualSpending: 70_000, brokerageDividendsAnnual: 0, state: "IL",
    accounts: [
      { id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 3_000_000 },
      { id: "c", label: "", kind: "cash", owner: "self", balance: 50_000, costBasis: 50_000 },
      ...(withBrokerage ? [{ id: "b", label: "", kind: "brokerage", owner: "self", balance: 1, costBasis: 1 }] : []),
    ],
  });
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...DEFAULT_INPUTS, survivor: null }) as any;
  const pNo = projectLifetime(mk(false), A);
  const pYes = projectLifetime(mk(true), A); // identical except a $1 brokerage exists to receive the surplus
  const gap = pYes.endingEstate - pNo.endingEstate;
  console.log(`A) RMD surplus destination: endingEstate WITHOUT brokerage acct ${fmt(pNo.endingEstate)} vs WITH $1 brokerage ${fmt(pYes.endingEstate)}`);
  console.log(`   → discontinuity ${fmt(gap)} by age 95 (pre-fix, surplus parked in 0%-growth cash cost $2,154,786)`);
  if (Math.abs(gap) > 100) {
    console.log(`FAIL: A) $1-brokerage discontinuity ${fmt(gap)} exceeds $100 — surplus not landing in a growing brokerage?`);
    process.exitCode = 1;
  }
}

// B) spendingSolver
{
  const hh: any = {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 40_000, ssClaimAge: 67 },
    spouse: { label: "B", birthYear: year - 64, socialSecurityAnnual: 25_000, ssClaimAge: 67 },
    pensionAnnual: 0, annualSpending: 150_000, brokerageDividendsAnnual: 10_000, state: "IL",
    accounts: [
      { id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 1_500_000 },
      { id: "b", label: "", kind: "brokerage", owner: "self", balance: 800_000, costBasis: 400_000 },
      { id: "r", label: "", kind: "roth_ira", owner: "self", balance: 300_000 },
      { id: "c", label: "", kind: "cash", owner: "self", balance: 150_000, costBasis: 150_000 },
    ],
  };
  const A = toAssumptions({ strategy: "smart", bracketTarget: 0.22, conv: false }, DEFAULT_INPUTS) as any;
  const model = returnModel(hh.accounts);
  const runs = 100;
  // monotonicity of success(spend) under the shared seed
  const spends = [60_000, 100_000, 140_000, 180_000, 220_000];
  const succ: number[] = [];
  for (const s of spends) {
    const r = await computeMonteCarlo({ kind: "mc", household: { ...hh, annualSpending: s }, assumptions: A, model, runs, seed: 4242 });
    succ.push(r.successPct);
  }
  console.log(`B) success(spend) @seed 4242: ${spends.map((s, i) => `${s / 1000}k→${(succ[i] * 100).toFixed(0)}%`).join(", ")}`);
  const monotone = succ.every((v, i) => i === 0 || v <= succ[i - 1] + 1e-9);
  console.log(`   monotone non-increasing: ${monotone ? "YES" : "NO"}`);
  const res = await solveSafeSpending(hh, A, [0.9, 0.5], { model, runs, iterations: 8, seed: 4242 });
  for (const r of res) {
    const recheck = await computeMonteCarlo({ kind: "mc", household: { ...hh, annualSpending: r.spend }, assumptions: A, model, runs, seed: 4242 });
    const above = await computeMonteCarlo({ kind: "mc", household: { ...hh, annualSpending: r.spend * 1.06 }, assumptions: A, model, runs, seed: 4242 });
    console.log(`   target ${(r.target * 100).toFixed(0)}%: spend ${fmt(r.spend)} success ${(r.success * 100).toFixed(1)}% (recheck ${(recheck.successPct * 100).toFixed(1)}%, +6% spend → ${(above.successPct * 100).toFixed(1)}%)`);
    if (recheck.successPct < r.target - 0.03) console.log(`   FAIL: solved spend does not meet target on re-run`);
  }
}
