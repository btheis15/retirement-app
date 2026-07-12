/**
 * AUDIT PROBE — IRMAA surcharge-dollar indexing + tier-crossing milestones.
 * Run: npx tsx scripts/_audit_irmaa_indexing_milestones.mts
 *
 * Hand math (2026 MFJ tiers, surcharge per person per month × 12 × enrollees):
 *  f=1:  MAGI 250,000 → tier 1: 96/mo   → 2 enrollees = 96×12×2   = 2,304 ; tierIndex 1
 *  f=2:  thresholds double (tier-1 ceiling 274k→548k) AND dollars double:
 *        MAGI 500,000 → tier 1: 192/mo  → 2 enrollees = 192×12×2  = 4,608 ; tierIndex 1
 *        MAGI 400,000 → still tier 1 (436k < 500k? no — 400k ≤ 548k, > 436k
 *        tier-0 ceiling 218k×2=436k) — i.e. crossing detection must use the
 *        INDEX, because dollars change every year even inside one tier.
 *  enrollees=0 → tierIndex −1 (not on Medicare), $0.
 *
 * Milestones (synthetic projection rows):
 *  tiers −1,−1,0,1,1,2,0 → expect: "begins" at the first 1 (year 2028),
 *  "rises" at the 2 (year 2030), "ends" at the final 0 (year 2031); nothing
 *  fired during the pre-Medicare −1 years or the flat 1→1 year.
 */
import { computeTaxes } from "../lib/tax/engine.ts";
import { detectMilestones } from "../lib/milestones.ts";
import type { ProjectionResult } from "../lib/projection.ts";
import type { Household } from "../lib/accounts.ts";

let fails = 0;
function check(name: string, got: number | boolean, want: number | boolean, tol = 0.01) {
  const ok = typeof got === "boolean" ? got === want : Math.abs((got as number) - (want as number)) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, expected ${want}`);
}

const base = {
  otherOrdinaryIncome: 0, preTaxWithdrawals: 0, socialSecurity: 0,
  qualifiedDividends: 0, longTermGains: 0, taxableInterest: 0, state: "none" as const,
  filingStatus: "mfj" as const,
};
const irmaa = (magi: number, enrollees: number, f = 1) =>
  computeTaxes({ ...base, num65Plus: enrollees, irmaaMagi: magi, inflationFactor: f }).irmaa;

// ── indexing ──
check("f=1 MAGI 250k → tier 1 household 2,304", irmaa(250_000, 2).householdAnnual, 2_304);
check("f=1 MAGI 250k → tierIndex 1", irmaa(250_000, 2).tierIndex, 1);
check("f=2 MAGI 500k → tier 1 (threshold doubled)", irmaa(500_000, 2).tierIndex >= 0 && irmaa(500_000, 2, 2).tierIndex === 1, true);
check("f=2 MAGI 500k → dollars doubled: 4,608", irmaa(500_000, 2, 2).householdAnnual, 4_608);
check("f=2 per-person/mo doubled: 192", irmaa(500_000, 2, 2).perPerson, 192);
check("enrollees 0 → tierIndex −1", irmaa(800_000, 0).tierIndex, -1);
check("standard tier → tierIndex 0", irmaa(100_000, 2).tierIndex, 0);

// ── milestones from tier crossings ──
// Minimal synthetic rows: only the fields detectMilestones touches.
const mkRow = (year: number, irmaaTier: number, irmaaLabel: string, irmaaAnnual: number) => ({
  year, selfAge: year - 1961, spouseAge: null, rmd: 0, fromPretax: 0, fromTaxable: 0,
  fromRoth: 0, conversion: 0, tax: 0, taxableSS: 0, marginalRate: 0.22, effMarginalRate: 0.22,
  magi: 0, inflationFactor: 1, irmaa: irmaaAnnual, irmaaTier, irmaaLabel, netCash: 0,
  spendingTarget: 0, startBalances: { pretax: 0, roth: 0, taxable: 0, total: 0 },
  endTotal: 1, shortfall: false,
});
const proj = {
  rows: [
    mkRow(2026, -1, "Not yet on Medicare", 0),
    mkRow(2027, -1, "Not yet on Medicare", 0),
    mkRow(2028, 0, "Standard premium", 0),
    mkRow(2029, 1, "Tier 1 surcharge", 2_304),
    mkRow(2030, 1, "Tier 1 surcharge", 2_361),
    mkRow(2031, 2, "Tier 2 surcharge", 5_900),
    mkRow(2032, 0, "Standard premium", 0),
  ],
} as unknown as ProjectionResult;
// Household with no SS/RMD noise in the probe window (born 1961 → RMDs far off).
const hh = {
  self: { label: "You", birthYear: 1961, socialSecurityAnnual: 0, ssClaimAge: 70 },
  spouse: { label: "Spouse", birthYear: 1961, socialSecurityAnnual: 0, ssClaimAge: 70 },
  pensionAnnual: 0, annualSpending: 0, brokerageDividendsAnnual: 0, state: "IL", accounts: [],
} as unknown as Household;

const ms = detectMilestones(hh, proj).filter((m) => m.icon === "🏥");
check("exactly 3 IRMAA milestones (begins, rises, ends)", ms.length, 3);
check("begins fires in 2029", ms[0]?.year ?? 0, 2029);
check("begins title mentions Tier 1", (ms[0]?.title ?? "").includes("Tier 1") && (ms[0]?.title ?? "").includes("begins"), true);
check("rises fires in 2031 (flat 2030 stays silent)", ms[1]?.year ?? 0, 2031);
check("2-year-lookback framing: detail cites 2029", (ms[1]?.detail ?? "").includes("2029"), true);
check("ends fires in 2032 with good tone", ms[2]?.year === 2032 && ms[2]?.tone === "good", true);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll IRMAA indexing/milestone checks passed");
if (fails) process.exit(1);
