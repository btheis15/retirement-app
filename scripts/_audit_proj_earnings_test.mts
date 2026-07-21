/**
 * AUDIT PROBE — earnings test + ARF through planYear/projectLifetime.
 * Run: npx tsx scripts/_audit_proj_earnings_test.mts
 *
 * Hand math (inflation 0, so everything stays in today's dollars):
 *  Born CY−62 (1964 cohort, FRA 67), PIA $30,000, claims at 62 (factor 0.70 →
 *  $21,000), works $60,000/yr through CY+2 (ages 62–64):
 *   - Years 0–2: withheld = (60,000−24,480)/2 = $17,760 → payable $3,240;
 *     months equivalent 17,760/1,750 = 10.14857/yr → 30.44571 total.
 *   - Year 3–4 (no wages): full $21,000, no withholding.
 *   - Year 5 (age 67, test-free): ARF bumps the claim age by 30.44571/12 =
 *     2.537 yrs → 64.537; ssBenefitFactor rounds to 30 months early →
 *     reduction 16.667% → benefit 30,000 × 0.83333 = $25,000/yr for life.
 *  Grace year: retire end of June (monthsWorked 6, wages 60,000 prorated from
 *  120,000): annual rule 17,760 but the monthly rule caps at 6/12 × 21,000 =
 *  $10,500 — the retired months' checks are untouchable.
 *  Spouse independence: one spouse's wages never reduce the OTHER's own
 *  retirement benefit.
 */
import { projectLifetime, ProjectionAssumptions } from "../lib/projection.ts";
import { planYear } from "../lib/optimizer.ts";
import type { Household, WorkIncome } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};
const near = (a: number, b: number, eps = 1) => Math.abs(a - b) < eps;

const CY = new Date().getFullYear();
const acct = { id: "a", label: "IRA", kind: "traditional_ira", owner: "self", balance: 800_000 } as Household["accounts"][number];
const hh = (selfSS: { pia: number; claim: number; work?: WorkIncome }, spouse?: { pia: number; claim: number; work?: WorkIncome }): Household =>
  ({
    self: { label: "You", birthYear: CY - 62, socialSecurityAnnual: selfSS.pia, ssClaimAge: selfSS.claim, work: selfSS.work },
    spouse: { label: "Sp", birthYear: CY - 62, socialSecurityAnnual: spouse?.pia ?? 0, ssClaimAge: spouse?.claim ?? 67, work: spouse?.work },
    pensionAnnual: 0, annualSpending: 40_000, brokerageDividendsAnnual: 0, state: "IL",
    accounts: [{ ...acct }],
  }) as Household;
const assume: ProjectionAssumptions = {
  strategy: "smart", bracketTarget: 0.22, returnRate: 0.05, inflationRate: 0, endAge: 90, convert: null, survivor: null,
};

// ── The claim-62-while-working lifetime path, with ARF payback ───────────────
const p = projectLifetime(hh({ pia: 30_000, claim: 62, work: { annualWages: 60_000, lastWorkYear: CY + 2 } }), assume);
check("years 0–2: $17,760/yr withheld", p.rows.slice(0, 3).every((r) => near(r.ssWithheld, 17_760)), `${p.rows[0].ssWithheld}`);
check("years 0–2: payable $3,240", p.rows.slice(0, 3).every((r) => near(r.socialSecurity, 3_240)), `${p.rows[0].socialSecurity}`);
check("total withheld $53,280", near(p.rows.reduce((s, r) => s + r.ssWithheld, 0), 53_280), `${p.rows.reduce((s, r) => s + r.ssWithheld, 0)}`);
check("year 3 (stopped working, still 65): full $21,000, no withholding", near(p.rows[3].socialSecurity, 21_000) && p.rows[3].ssWithheld === 0);
check("year 4 (age 66): still the reduced $21,000 (ARF not yet)", near(p.rows[4].socialSecurity, 21_000));
check("year 5 (age 67): ARF pays it back → $25,000/yr", near(p.rows[5].socialSecurity, 25_000, 2), `${p.rows[5].socialSecurity.toFixed(0)}`);
check("…permanently", near(p.rows[10].socialSecurity, 25_000, 2), `${p.rows[10].socialSecurity.toFixed(0)}`);

// ── Not working: identical claim, zero withholding, no ARF drift ─────────────
const q = projectLifetime(hh({ pia: 30_000, claim: 62 }), assume);
check("non-worker: never withheld, $21,000 for life", q.rows.every((r) => r.ssWithheld === 0) && near(q.rows[8].socialSecurity, 21_000));

// ── Grace year: the mid-year retiree keeps the retired months' checks ────────
const g = planYear(hh({ pia: 30_000, claim: 62, work: { annualWages: 120_000, lastWorkYear: CY, lastWorkMonth: 6 } }), {
  strategy: "smart", bracketTarget: 0.22, year: CY,
});
check("grace year: withheld capped at 6/12 × benefit = $10,500", near(g.ssWithheld, 10_500), `${g.ssWithheld}`);
check("grace year: fixed.wages prorated to $60,000", g.fixed.wages === 60_000);
check("grace year: note explains the withholding", g.notes.some((n) => n.includes("holds back")));

// ── Spouse independence: your wages never touch your spouse's own benefit ────
const s = planYear(hh({ pia: 0, claim: 67, work: { annualWages: 100_000, lastWorkYear: CY + 5 } }, { pia: 24_000, claim: 62 }), {
  strategy: "smart", bracketTarget: 0.22, year: CY,
});
check("working self, claiming spouse: nothing withheld", s.ssWithheld === 0 && near(s.fixed.socialSecurity, 16_800), `${s.fixed.socialSecurity}`);

// ── Claiming at FRA while working: no test at all ────────────────────────────
const f = projectLifetime(hh({ pia: 30_000, claim: 67, work: { annualWages: 200_000, lastWorkYear: CY + 10 } }), assume);
check("claim-at-FRA worker: never withheld", f.rows.every((r) => r.ssWithheld === 0));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
