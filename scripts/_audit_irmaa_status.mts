/**
 * AUDIT PROBE — buildIrmaaStatus (the Plan-tab Medicare meter).
 * Run: npx tsx scripts/_audit_irmaa_status.mts
 *
 * Hand math (2026 MFJ tiers): MAGI 250,000 → tier 1 (218k < 250k ≤ 274k):
 *  per-person $96/mo, household 96×12×2 = 2,304/yr, headroom 274,000−250,000 =
 *  24,000, next jump (240−96)×12×2 = 3,456/yr, billed 2026+2 = 2028.
 * Single (sentinel spouse birthYear 1900): thresholds 109k/137k; 1 enrollee.
 */
import { buildIrmaaStatus } from "../lib/irmaaStatus.ts";
import type { Household } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

const hh = (selfBirth: number, spouseBirth: number): Household =>
  ({
    self: { label: "You", birthYear: selfBirth, socialSecurityAnnual: 0, ssClaimAge: 67 },
    spouse: { label: "Spouse", birthYear: spouseBirth, socialSecurityAnnual: 0, ssClaimAge: 67 },
    pensionAnnual: 0, annualSpending: 0, brokerageDividendsAnnual: 0, state: "IL", accounts: [],
  }) as unknown as Household;

// Both 66 (born 1960), MFJ, MAGI 250k → tier 1
const a = buildIrmaaStatus(hh(1960, 1960), 250_000, "mfj", 2026)!;
check("66/66: enrollees 2 now / 2 at billing", a.enrolleesNow === 2 && a.enrolleesAtBilling === 2);
check("tier 1 label + in surcharge", a.inSurcharge && a.label.includes("Tier 1"));
check("household 2,304/yr", Math.abs(a.householdAnnual - 2_304) < 0.01, `${a.householdAnnual}`);
check("headroom 24,000", Math.abs(a.headroom - 24_000) < 0.01, `${a.headroom}`);
check("next jump 3,456/yr", Math.abs(a.nextJumpAnnual - 3_456) < 0.01, `${a.nextJumpAnnual}`);
check("bills in 2028", a.billingYear === 2028);
check("not inWindow (already enrolled)", !a.inWindow);

// Both 63 (born 1963): 0 now, 2 at billing → the pre-65 window
const b = buildIrmaaStatus(hh(1963, 1963), 100_000, "mfj", 2026)!;
check("63/63: inWindow, 0 now / 2 at billing", b.inWindow && b.enrolleesNow === 0 && b.enrolleesAtBilling === 2);
check("63/63 low MAGI: no surcharge, standard label", !b.inSurcharge);

// Both 60: meter has nothing to say → null
check("60/60 → null (nobody within 2 years of 65)", buildIrmaaStatus(hh(1966, 1966), 500_000, "mfj", 2026) === null);

// Single filer (sentinel spouse): 1 enrollee, single thresholds (109k line)
const d = buildIrmaaStatus(hh(1960, 1900), 120_000, "single", 2026)!;
check("single: 1 enrollee (sentinel spouse never counts)", d.enrolleesNow === 1 && d.enrolleesAtBilling === 1);
check("single MAGI 120k → in surcharge (line at 109k)", d.inSurcharge);
check("single household = per-person ×12 ×1", Math.abs(d.householdAnnual - d.perPersonMonthly * 12) < 0.01);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll IRMAA-status checks passed");
if (fails) process.exit(1);
