/**
 * AUDIT PROBE — the quarterly client report (lib/report + lib/quarterly).
 * Run: npx tsx scripts/_audit_report.mts
 *
 * Checks:
 *  - one number, one source: across the example + 30 randomized households and
 *    three settings mixes, this year's conversion and all-in tax agree between
 *    the year plan (the to-do list) and the projection (the Plan tab hero)
 *  - the report's funding table ties out to the penny: itemized sources − income
 *    tax on that income − payroll tax = cash left to spend (planYear.netCash)
 *  - the to-do list's conversion and tax items quote those same numbers
 *  - quarter math: boundaries (Mar 31 → Q1, Apr 1 → Q2, Dec 31 → Q4), ranges,
 *    next-quarter wrap, and string-sortable keys
 *  - agendas: each 1040-ES due date lands in exactly one quarter's agenda (incl.
 *    the January catch-up for the prior year), the Dec 31 RMD/conversion items
 *    appear only in Q4, and Q1 carries the re-plan + tax-forms reviews
 *  - snapshot comparison: direction and wording of changes
 */
import { buildReport } from "../lib/report.ts";
import { quarterOf, quarterFor, nextQuarter, quarterAgenda, compareSnapshots, AgendaContext, ReviewSnapshot } from "../lib/quarterly.ts";
import { DEMO_HOUSEHOLD, randomDemoHousehold } from "../lib/demo.ts";
import { syncHouseholdDividends } from "../lib/dividends.ts";
import { DEFAULT_SETTINGS, PlannerSettings } from "../lib/defaults.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

// ---- Consistency + tie-out across many households ----
const settingsMixes: PlannerSettings[] = [
  DEFAULT_SETTINGS,
  { ...DEFAULT_SETTINGS, strategy: "conventional", useConversions: true, convertMode: "recommended", convertUntilAge: 80 },
  { ...DEFAULT_SETTINGS, useConversions: true, convertMode: "fillBracket", bracketTarget: 0.24, dividendMode: "spend" },
];
let convGap = 0;
let taxGap = 0;
let tieGap = 0;
let todoGap = 0;
let cases = 0;
const now = new Date(2026, 9, 9, 12);
for (let i = 0; i <= 30; i++) {
  const h = syncHouseholdDividends(i === 0 ? DEMO_HOUSEHOLD : randomDemoHousehold(i));
  for (const s of settingsMixes) {
    const r = buildReport(h, s, now);
    const p = r.ctx.planConv;
    cases++;
    convGap = Math.max(convGap, Math.abs(p.conversion - r.ctx.thisYearConversion));
    taxGap = Math.max(taxGap, Math.abs(p.tax.totalTax - r.ctx.yearTaxTotal));
    const draws = p.withdrawals.pretax + p.withdrawals.taxable + p.withdrawals.roth;
    const investCash = Math.max(0, p.grossInflow - p.fixed.socialSecurity - p.fixed.pension - p.fixed.wages - p.fixed.otherIncome - draws);
    const rows = p.fixed.socialSecurity + p.fixed.pension + p.fixed.wages + p.fixed.otherIncome + draws + investCash - (p.tax.totalTax - p.conversionTax) - p.ficaTax;
    tieGap = Math.max(tieGap, Math.abs(rows - p.netCash));
    const conv = r.todo.find((t) => t.kind === "convert");
    const tax = r.todo.find((t) => t.kind === "tax");
    if (conv) todoGap = Math.max(todoGap, Math.abs((conv.amount ?? 0) - p.conversion));
    if (tax) todoGap = Math.max(todoGap, Math.abs((tax.amount ?? 0) - r.ctx.yearTaxTotal));
  }
}
check(`conversion: year plan = projection year 1 (${cases} cases)`, convGap <= 1, `worst gap $${convGap.toFixed(2)}`);
check(`all-in tax: year plan = projection year 1 (${cases} cases)`, taxGap <= 1, `worst gap $${taxGap.toFixed(2)}`);
check("funding table ties out: sources − tax − payroll tax = cash to spend", tieGap <= 0.01, `worst gap $${tieGap.toFixed(4)}`);
check("to-do conversion & tax items quote the same numbers", todoGap <= 1, `worst gap $${todoGap.toFixed(2)}`);

// ---- Quarter math ----
check("Mar 31 is Q1", quarterOf(new Date(2026, 2, 31, 23, 0)).key === "2026-Q1");
check("Apr 1 is Q2", quarterOf(new Date(2026, 3, 1)).key === "2026-Q2");
check("Dec 31 is Q4", quarterOf(new Date(2026, 11, 31, 22, 0)).key === "2026-Q4");
check("Q4 range label", quarterFor(2026, 4).rangeLabel === "Oct 1 – Dec 31, 2026", quarterFor(2026, 4).rangeLabel);
check("Q1 range ends Mar 31", quarterFor(2027, 1).end.getDate() === 31 && quarterFor(2027, 1).end.getMonth() === 2);
check("next quarter wraps the year", nextQuarter(quarterFor(2026, 4)).key === "2027-Q1");
check("keys sort chronologically as strings", ["2027-Q1", "2026-Q4", "2026-Q2"].sort().join() === "2026-Q2,2026-Q4,2027-Q1");

// ---- Agendas ----
const ctx: AgendaContext = {
  planYear: 2026,
  rmd: 40_000,
  conversion: 60_000,
  yearTax: 48_000,
  withholdPct: null,
  onMedicare: true,
  inIrmaaWindow: false,
  irmaaHeadroom: 20_000,
  qcdEligible: true,
  hasBrokerage: true,
  hasLosses: false,
  isIL: true,
};
const agendas = ([1, 2, 3, 4] as const).map((q) => quarterAgenda(quarterFor(2026, q), ctx));
const est = agendas.map((a) => a.filter((x) => x.title.startsWith("Estimated tax payment")).map((x) => x.when));
check("Q1 has only the January catch-up for last year", est[0].join() === "Jan 15" && agendas[0].some((x) => x.title.includes("(2025 income)")), est[0].join());
check("Q2 has Apr 15 + Jun 15 installments", est[1].join() === "Apr 15,Jun 15", est[1].join());
check("Q3 has Sep 15", est[2].join() === "Sep 15", est[2].join());
check("Q4 has none (Jan 15 belongs to next Q1)", est[3].length === 0, est[3].join());
check("installment amount = year tax / 4", agendas[1][0].detail.includes("$12,000"));
const dec31 = agendas.map((a) => a.filter((x) => x.when === "Dec 31").length);
check("Dec 31 RMD + conversion only in Q4", dec31.join() === "0,0,0,2", dec31.join());
check("QCD only in Q4", agendas.map((a) => a.some((x) => x.title.includes("QCD"))).join() === "false,false,false,true");
check("Q1 re-plan + tax forms reviews", agendas[0].some((x) => x.title.startsWith("Re-plan")) && agendas[0].some((x) => x.title.includes("tax forms")));
check("Q2 carries the April filing", agendas[1].some((x) => x.title.includes("File your 2025 tax return")));
check("Q3 IRMAA headroom check quotes the room", agendas[2].some((x) => x.detail.includes("$20K")));
check("Q4 Medicare open enrollment when on Medicare", agendas[3].some((x) => x.when === "Oct 15 – Dec 7"));
const nextYearQ4 = quarterAgenda(quarterFor(2027, 4), ctx);
check("a later year's Q4 doesn't quote this year's RMD/conversion", !nextYearQ4.some((x) => x.when === "Dec 31"));
check("deadlines listed before reviews", agendas.every((a) => a.findIndex((x) => x.kind === "review") === -1 || a.slice(a.findIndex((x) => x.kind === "review")).every((x) => x.kind === "review")));

// ---- Snapshot comparison ----
const base: ReviewSnapshot = {
  quarter: "2026-Q3",
  at: 0,
  total: 1_000_000,
  buckets: { pretax: 600_000, roth: 100_000, taxable: 300_000 },
  spending: 80_000,
  successPct: 0.9,
  yearTax: 10_000,
  conversion: 0,
  estateAfterTax: 2_000_000,
  returnRate: 0.06,
  planLabel: "Most money left · Brokerage-first (conventional)",
  claimAges: "You 67",
};
const ch = compareSnapshots(base, { ...base, quarter: "2026-Q4", total: 1_050_000, successPct: 0.86, yearTax: 12_000, claimAges: "You 70" });
const by = (l: string) => ch.find((c) => c.label === l)!;
check("savings up 5% reads +$50K (+5.0%), good", by("Total savings").delta === "+$50K (+5.0%)" && by("Total savings").tone === "up", by("Total savings").delta);
check("confidence −4 pts reads as down", by("Plan confidence").delta === "−4 pts" && by("Plan confidence").tone === "down");
check("higher tax reads as down (bad)", by("This year's tax").tone === "down");
check("unchanged spending says no delta", by("Planned spending (per year)").delta === "" && by("Planned spending (per year)").tone === "same");
check("claim-age change is listed", !!ch.find((c) => c.label === "Social Security claim ages"));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll report checks passed");
if (fails) process.exit(1);
