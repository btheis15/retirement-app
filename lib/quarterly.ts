/**
 * Quarterly reviews — the rhythm an advisor keeps with a retired client.
 *
 *   quarterOf()     — which calendar quarter a date falls in, with its range
 *   quarterAgenda() — what THIS quarter asks of this household: the dated
 *                     deadlines that land in it (estimated tax, Dec 31 RMD and
 *                     conversion, Medicare open enrollment, the April filing)
 *                     plus the seasonal reviews an advisor would run (January
 *                     re-plan, mid-year pace check, Q3 IRMAA projection, Q4
 *                     harvesting / QCD / true-up)
 *   ReviewSnapshot  — the handful of numbers saved each quarter so the next
 *                     review can say what changed "since your last review"
 *
 * Pure and date-injected. ⚠️ Educational estimates only — not tax advice.
 */

import { money, moneyCompact } from "./format";

export type QuarterNum = 1 | 2 | 3 | 4;

export interface Quarter {
  year: number;
  q: QuarterNum;
  /** Stable storage key, e.g. "2026-Q4". */
  key: string;
  /** Display label, e.g. "Q4 2026". */
  label: string;
  start: Date;
  /** Last day of the quarter. */
  end: Date;
  /** e.g. "Oct 1 – Dec 31, 2026". */
  rangeLabel: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function quarterFor(year: number, q: QuarterNum): Quarter {
  const start = new Date(year, (q - 1) * 3, 1);
  const end = new Date(year, q * 3, 0);
  return {
    year,
    q,
    key: `${year}-Q${q}`,
    label: `Q${q} ${year}`,
    start,
    end,
    rangeLabel: `${MON[start.getMonth()]} 1 – ${MON[end.getMonth()]} ${end.getDate()}, ${year}`,
  };
}

export function quarterOf(d: Date): Quarter {
  return quarterFor(d.getFullYear(), (Math.floor(d.getMonth() / 3) + 1) as QuarterNum);
}

export function nextQuarter(q: Quarter): Quarter {
  return q.q === 4 ? quarterFor(q.year + 1, 1) : quarterFor(q.year, (q.q + 1) as QuarterNum);
}

/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/* ------------------------------------------------------------------ */

export interface AgendaItem {
  /** "Jan 15", "Dec 31", "Oct 15 – Dec 7", or "This quarter". */
  when: string;
  title: string;
  detail: string;
  kind: "deadline" | "review";
}

export interface AgendaContext {
  /** The plan year the numbers below describe (the current calendar year). */
  planYear: number;
  /** This year's required minimum distribution (household). */
  rmd: number;
  /** This year's planned Roth conversion. */
  conversion: number;
  /** This year's all-in tax. */
  yearTax: number;
  /** % to withhold on pre-tax withdrawals to cover the year's tax, if that
   *  works (≤ 90%); null when quarterly estimates are the way to pay. */
  withholdPct: number | null;
  /** Anyone on Medicare (65+) this year. */
  onMedicare: boolean;
  /** Anyone whose income this year sets a first Medicare premium (63–64). */
  inIrmaaWindow: boolean;
  /** Headroom below the next IRMAA line (Infinity when not applicable). */
  irmaaHeadroom: number;
  /** Anyone 70½+ with pre-tax money (QCD-eligible). */
  qcdEligible: boolean;
  /** Has a taxable brokerage account (harvesting, gains management). */
  hasBrokerage: boolean;
  /** Has holdings currently below cost (loss-harvest candidates). */
  hasLosses: boolean;
  /** Illinois resident (state estimated tax). */
  isIL: boolean;
}

/** IRS 1040-ES installment covering `year`'s income, by index 0–3. */
const EST_DUE = (year: number) => [
  { date: new Date(year, 3, 15), label: "Apr 15", n: 1 },
  { date: new Date(year, 5, 15), label: "Jun 15", n: 2 },
  { date: new Date(year, 8, 15), label: "Sep 15", n: 3 },
  { date: new Date(year + 1, 0, 15), label: "Jan 15", n: 4 },
];

/** What a given quarter asks of this household, in date order. The context
 *  numbers describe ctx.planYear; for a quarter in a later year (the "next
 *  quarter" preview in Q4) the amounts are labeled as estimates to re-confirm. */
export function quarterAgenda(q: Quarter, ctx: AgendaContext): AgendaItem[] {
  const out: AgendaItem[] = [];
  const sameYear = q.year === ctx.planYear;
  const est = ctx.yearTax >= 4_000 ? ctx.yearTax / 4 : 0;
  const inQ = (d: Date) => d >= q.start && d <= new Date(q.end.getFullYear(), q.end.getMonth(), q.end.getDate(), 23, 59);

  // Estimated-tax installments landing in this quarter (this year's, and the
  // prior year's January catch-up).
  if (est > 0) {
    for (const y of [q.year - 1, q.year]) {
      for (const e of EST_DUE(y)) {
        if (!inQ(e.date)) continue;
        const amt = y === ctx.planYear ? ` of about ${money(Math.round(est))}` : "";
        out.push({
          when: e.label,
          kind: "deadline",
          title: `Estimated tax payment ${e.n} of 4 (${y} income)`,
          detail:
            (ctx.withholdPct != null
              ? `Skip this if you're having ${ctx.withholdPct}% withheld from your pre-tax withdrawals instead. Otherwise pay${amt} with IRS Form 1040-ES (IRS Direct Pay works).`
              : `Pay${amt} with IRS Form 1040-ES (IRS Direct Pay works).`) +
            (ctx.isIL ? " Illinois expects its own installment (IL-1040-ES) if you'll owe the state more than $1,000." : ""),
        });
      }
    }
  }

  if (q.q === 1) {
    out.push({
      when: "This quarter",
      kind: "review",
      title: `Re-plan for the ${q.year} tax year`,
      detail:
        "New brackets, a new standard deduction, and new Medicare lines take effect. Update account balances to your December 31 statements — they set this year's required withdrawals — then re-confirm spending and re-size this year's Roth conversion in the app.",
    });
    out.push({
      when: "By Feb 15",
      kind: "review",
      title: "Collect your tax forms",
      detail:
        "1099-R (IRA/401k withdrawals and conversions), 1099-DIV/1099-B (brokerage), 1099-INT, and SSA-1099 (Social Security) arrive by late January to mid-February. Hand them to your CPA together with last year's plan.",
    });
    if (ctx.withholdPct != null) {
      out.push({
        when: "This quarter",
        kind: "review",
        title: "Set up withholding for the year",
        detail: `Ask your custodian to withhold about ${ctx.withholdPct}% federal tax on pre-tax withdrawals. Withholding counts as paid evenly through the year, so it avoids quarterly estimates and underpayment penalties.`,
      });
    }
  }

  if (q.q === 2) {
    out.push({
      when: "Apr 15",
      kind: "deadline",
      title: `File your ${q.year - 1} tax return`,
      detail: "Or file an extension (Form 4868) — an extension delays the paperwork, not the payment. Any balance due is still owed by April 15.",
    });
    out.push({
      when: "This quarter",
      kind: "review",
      title: "Mid-year pace check",
      detail:
        (sameYear && ctx.conversion > 0.5
          ? `Compare withdrawals so far against the plan. If markets are down, consider doing part of this year's ${moneyCompact(ctx.conversion)} Roth conversion now — the same dollars of tax move more shares into Roth. `
          : "Compare withdrawals so far against the plan, and refresh balances if markets have moved a lot. ") +
        "Nothing needs to be exactly on pace — the December 31 totals are what count.",
    });
  }

  if (q.q === 3) {
    out.push({
      when: "This quarter",
      kind: "review",
      title: "Project year-end income before the big moves",
      detail:
        ctx.onMedicare || ctx.inIrmaaWindow
          ? `Before any large withdrawal or conversion in Q4, check where this year's income (MAGI) lands against the Medicare (IRMAA) lines${
              sameYear && Number.isFinite(ctx.irmaaHeadroom)
                ? ctx.irmaaHeadroom < 1_000
                  ? " — it currently sits right at the edge of the next one"
                  : ` — currently about ${moneyCompact(ctx.irmaaHeadroom)} of room below the next one`
                : ""
            }. Crossing a line by $1 costs the full surcharge two years later.`
          : "Before any large withdrawal or conversion in Q4, estimate where this year's taxable income will land so the year-end moves stay inside your target bracket.",
    });
  }

  if (q.q === 4) {
    if (ctx.onMedicare) {
      out.push({
        when: "Oct 15 – Dec 7",
        kind: "deadline",
        title: "Medicare open enrollment",
        detail: "Review your Part D drug plan or Medicare Advantage plan for next year — formularies and premiums change every year.",
      });
    }
    if (ctx.hasBrokerage) {
      out.push({
        when: "By Dec 31",
        kind: "review",
        title: ctx.hasLosses ? "Harvest losses (and maybe gains)" : "Review gains before year-end",
        detail: ctx.hasLosses
          ? "Some holdings are below what you paid. Selling them realizes a loss that offsets gains and up to $3,000 of ordinary income; buy a similar (not identical) fund to stay invested and avoid the 30-day wash-sale rule."
          : "If this year's taxable income sits in the 0% capital-gains range, selling winners and rebuying resets your cost basis tax-free. Otherwise, avoid realizing large gains you don't need.",
      });
    }
    if (sameYear && ctx.qcdEligible) {
      out.push({
        when: "By Dec 31",
        kind: "review",
        title: "Give to charity from your IRA (QCD)",
        detail:
          "From age 70½, gifts sent directly from your IRA to a charity (a Qualified Charitable Distribution) count toward your RMD but are never taxed — better than giving cash and taking a deduction, especially with the standard deduction.",
      });
    }
    if (sameYear && ctx.conversion > 0.5) {
      out.push({
        when: "Dec 31",
        kind: "deadline",
        title: `Complete the ${moneyCompact(ctx.conversion)} Roth conversion`,
        detail:
          "A conversion counts for the year it happens. It was sized on projected numbers — in December, re-check it in the app against your actual year-end income, then ask your custodian for a \"Roth conversion\".",
      });
    }
    if (sameYear && ctx.rmd > 0.5) {
      out.push({
        when: "Dec 31",
        kind: "deadline",
        title: `Finish the ${moneyCompact(ctx.rmd)} required withdrawal (RMD)`,
        detail: "Any shortfall is hit with a 25% excise tax (cut to 10% if corrected within two years). Each spouse's RMD must come from their own accounts.",
      });
    }
  }

  // Deadlines first by date-ish order; "This quarter" reviews after.
  const rank = (a: AgendaItem) => (a.kind === "deadline" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/* ------------------------------------------------------------------ */
/* Snapshots — "since your last review"                                */
/* ------------------------------------------------------------------ */

export interface ReviewSnapshot {
  /** Quarter key, e.g. "2026-Q4". */
  quarter: string;
  /** When the review was generated (ms). */
  at: number;
  total: number;
  buckets: { pretax: number; roth: number; taxable: number };
  spending: number;
  /** Monte-Carlo success (0–1), null if it hadn't finished. */
  successPct: number | null;
  yearTax: number;
  conversion: number;
  estateAfterTax: number;
  returnRate: number;
  /** Plain-language plan label (goal + method). */
  planLabel: string;
  claimAges: string;
}

export interface SnapshotChange {
  label: string;
  before: string;
  after: string;
  /** Short delta, e.g. "+$212K (+4.2%)". Empty when unchanged. */
  delta: string;
  tone: "up" | "down" | "same";
}

const pctStr = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** What moved between two reviews, in the order a client cares about. */
export function compareSnapshots(prev: ReviewSnapshot, cur: ReviewSnapshot): SnapshotChange[] {
  const out: SnapshotChange[] = [];
  const money$ = (a: number, b: number, label: string, upIsGood = true) => {
    const d = b - a;
    const same = Math.abs(d) < Math.max(500, Math.abs(a) * 0.002);
    out.push({
      label,
      before: moneyCompact(a),
      after: moneyCompact(b),
      delta: same ? "" : `${d >= 0 ? "+" : "−"}${moneyCompact(Math.abs(d))}${a > 0 ? ` (${pctStr(d / a)})` : ""}`,
      tone: same ? "same" : d > 0 === upIsGood ? "up" : "down",
    });
  };
  money$(prev.total, cur.total, "Total savings");
  money$(prev.spending, cur.spending, "Planned spending (per year)");
  if (prev.successPct != null && cur.successPct != null) {
    const d = cur.successPct - prev.successPct;
    const same = Math.abs(d) < 0.01;
    out.push({
      label: "Plan confidence",
      before: `${Math.round(prev.successPct * 100)}%`,
      after: `${Math.round(cur.successPct * 100)}%`,
      delta: same ? "" : `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))} pts`,
      tone: same ? "same" : d > 0 ? "up" : "down",
    });
  }
  money$(prev.estateAfterTax, cur.estateAfterTax, "Projected estate (after tax)");
  money$(prev.yearTax, cur.yearTax, "This year's tax", false);
  if (prev.planLabel !== cur.planLabel) out.push({ label: "Strategy", before: prev.planLabel, after: cur.planLabel, delta: "changed", tone: "same" });
  if (prev.claimAges !== cur.claimAges) out.push({ label: "Social Security claim ages", before: prev.claimAges, after: cur.claimAges, delta: "changed", tone: "same" });
  return out;
}
