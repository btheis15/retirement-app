/**
 * AUDIT PROBE — IRMAA cliff guard on RECOMMENDED conversion sizing.
 * Run: npx tsx scripts/_audit_conversion_irmaa_cap.mts
 *
 * Setup (all cases): MFJ, state none, SS $0, pension $100k, spending $60k,
 * conventional strategy (so spending draws come from cash — no bracket fill
 * before the conversion), $3M pre-tax + $500k cash. Pre-conversion MAGI ≈
 * $100k, far below the tier-1 line (MAGI $218,000 at f=1). A recommended
 * conversion fills ordinary taxable income to the 22% MFJ ceiling, putting
 * MAGI = OTI + deductions ≈ $240k — crossing the $218k cliff by ~$22k.
 *
 * Economics: crossing costs the household the full tier-1 surcharge for a
 * year = 96/mo × 12 × 2 enrollees = $2,304 (f=1).
 *  A) futureRate 0.26: arbitrage saving on the overshoot ≈ (0.26 − ~0.24) ×
 *     ~$22k ≈ $450 < $2,304 → TRIM to sit exactly on the line (MAGI 218,000).
 *  B) futureRate 0.60: saving ≈ (0.60 − ~0.24) × ~$22k ≈ $8k > $2,304 → KEEP
 *     (uncapped fill; comfort bracket 0.22 caps the fill in both cases, so A
 *     and B size the same conversion before the guard).
 *  C) Pre-65 lookahead: both spouses 63 → 0 enrollees TODAY but 2 at billing
 *     (age 65, two years out) → the guard must still trim (case-A economics).
 *  D) Both spouses 60 → nobody on Medicare at billing → guard inert, no trim.
 */
import { planYear } from "../lib/optimizer.ts";
import { FILING_CONSTANTS } from "../lib/tax/constants.ts";
import type { Household } from "../lib/accounts.ts";

let fails = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
}

const CLIFF = FILING_CONSTANTS.mfj.irmaaTiers[0].upTo; // 218,000: top of the standard tier
const TIER1_HH = FILING_CONSTANTS.mfj.irmaaTiers[1].monthlyPerPerson * 12 * 2; // 2,304

function hh(birthYear: number): Household {
  return {
    self: { label: "You", birthYear, socialSecurityAnnual: 0, ssClaimAge: 70 },
    spouse: { label: "Spouse", birthYear, socialSecurityAnnual: 0, ssClaimAge: 70 },
    pensionAnnual: 100_000,
    annualSpending: 60_000,
    brokerageDividendsAnnual: 0,
    state: "none",
    retirementYear: 2026,
    accounts: [
      { id: "p", label: "IRA", kind: "traditional_ira", owner: "self", balance: 3_000_000 },
      { id: "c", label: "Cash", kind: "cash", owner: "self", balance: 500_000 },
    ],
  } as unknown as Household;
}

const run = (birthYear: number, futureRate: number) =>
  planYear(hh(birthYear), {
    strategy: "conventional",
    bracketTarget: 0.22,
    year: 2026,
    filingStatus: "mfj",
    conversion: { mode: "recommended", futureRate },
  });

// A) modest arbitrage → trim to the line
const a = run(1960, 0.26); // both 66: on Medicare now and at billing
const aTrimNote = a.notes.some((n) => n.includes("Trimmed the conversion"));
check("A: trim note present", aTrimNote);
check("A: MAGI sits exactly on the tier-1 line", Math.abs(a.tax.magi - CLIFF) < 2, `magi ${Math.round(a.tax.magi)}`);
check("A: still converts a meaningful amount", a.conversion > 50_000, `conv ${Math.round(a.conversion)}`);

// B) rich arbitrage → the overshoot earns its premium, keep the full fill
const b = run(1960, 0.6);
check("B: no trim note", !b.notes.some((n) => n.includes("Trimmed the conversion")));
check("B: MAGI crosses the line (overshoot kept)", b.tax.magi > CLIFF + 5_000, `magi ${Math.round(b.tax.magi)}`);
check(
  "B: sanity — B's kept overshoot saving beats the tier-1 jump cost",
  (0.6 - 0.3) * (b.tax.magi - CLIFF) > TIER1_HH,
);

// A vs B sized identically before the guard (same comfort-bracket fill)
check("A+B: guard is the only difference", b.conversion - a.conversion > 5_000, `Δ ${Math.round(b.conversion - a.conversion)}`);
check("A: trimmed amount equals B's overshoot", Math.abs(b.conversion - a.conversion - (b.tax.magi - CLIFF)) < 2);

// C) both 63 → first premium at 65 is set by THIS year's MAGI → still trims
const c = run(1963, 0.26);
check("C: pre-65 (age 63) still trims", c.notes.some((n) => n.includes("Trimmed the conversion")));
check("C: pre-65 MAGI on the line", Math.abs(c.tax.magi - CLIFF) < 2, `magi ${Math.round(c.tax.magi)}`);

// D) both 60 → not on Medicare at billing either → guard must stay inert
const d = run(1966, 0.26);
check("D: age 60 — no trim", !d.notes.some((n) => n.includes("Trimmed the conversion")));
check("D: age 60 — full fill kept", d.tax.magi > CLIFF + 5_000, `magi ${Math.round(d.tax.magi)}`);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll conversion IRMAA-cap checks passed");
if (fails) process.exit(1);
