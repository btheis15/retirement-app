/**
 * AUDIT PROBE — priorMagi seeding of the IRMAA lookback (years 1–2).
 * Run: npx tsx scripts/_audit_prior_magi.mts
 *
 * Household: MFJ both 66 (born 1960), pension $60k, spending $50k → in-plan
 * MAGI ~$60k, far below every IRMAA line. But they just retired: real MAGI
 * was $400,000 two years ago and $250,000 last year. 2026 MFJ tiers: $400k ≤
 * the $410k tier-3 ceiling → tier 3 ($385/mo); $250k → tier 1 ($96/mo).
 *
 * Expect (2 enrollees, f≈1 in year 1; year-2 dollars indexed by one year of
 * the 2.5% default inflation):
 *  y1 irmaa = 385×12×2 = 9,240 exactly
 *  y2 irmaa = 96×12×2 × (1 + inflation) ≈ 2,304 × 1.025 = 2,361.60
 *  y3+ back to $0 (in-projection lookback of the low retirement income)
 *  Without priorMagi: y1/y2 fall back to same-year MAGI → $0 surcharge.
 */
import { projectLifetime } from "../lib/projection.ts";
import type { Household } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, got: number, want: number, tol = 0.5) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got.toFixed(2)}, expected ${want.toFixed(2)}`);
};

const mk = (priorMagi?: { twoYearsAgo?: number; lastYear?: number }): Household =>
  ({
    self: { label: "You", birthYear: 1960, socialSecurityAnnual: 0, ssClaimAge: 70 },
    spouse: { label: "Spouse", birthYear: 1960, socialSecurityAnnual: 0, ssClaimAge: 70 },
    pensionAnnual: 60_000,
    annualSpending: 50_000,
    brokerageDividendsAnnual: 0,
    state: "none",
    retirementYear: 2026,
    priorMagi,
    accounts: [
      { id: "c", label: "Cash", kind: "cash", owner: "self", balance: 2_000_000 },
    ],
  }) as unknown as Household;

const assumptions = {
  strategy: "conventional" as const,
  bracketTarget: 0.22 as const,
  endAge: 90,
  returnRate: 0.05,
  inflationRate: 0.025,
  filingStatus: "mfj" as const,
  convert: null,
  returnFor: null,
};

const withPrior = projectLifetime(mk({ twoYearsAgo: 400_000, lastYear: 250_000 }), assumptions as never);
check("y1 premium from $400k working income → tier 3: 9,240", withPrior.rows[0].irmaa, 9_240);
check("y2 premium from $250k → tier 1 × one year's indexing: 2,361.60", withPrior.rows[1].irmaa, 2_304 * 1.025, 1);
check("y3 back to standard (in-plan income is low): 0", withPrior.rows[2].irmaa, 0);

const noPrior = projectLifetime(mk(undefined), assumptions as never);
check("without priorMagi: y1 falls back to same-year MAGI → 0", noPrior.rows[0].irmaa, 0);
check("without priorMagi: y2 → 0", noPrior.rows[1].irmaa, 0);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll prior-MAGI lookback checks passed");
if (fails) process.exit(1);
