/**
 * The quarterly client report — an advisor-style plan document, laid out as
 * letter-size pages. Every number comes from lib/report (the same engine path
 * as the Plan tab) plus the Monte-Carlo result; this component only writes it
 * up: what to do, why, and the supporting detail, in the order an advisor
 * would present it.
 *
 * Printing: each <Page> starts on a new sheet; tables and figures avoid
 * splitting; colors print exactly. See the report rules in app/globals.css.
 */

import { ReactNode } from "react";
import { Household } from "@/lib/accounts";
import { PlannerSettings } from "@/lib/defaults";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { ReportData } from "@/lib/report";
import { ReviewSnapshot, SnapshotChange } from "@/lib/quarterly";
import { money, moneyCompact, percent } from "@/lib/format";
import { AllocationBar, BalancesChart, OutcomeFan, REPORT_COLORS } from "@/components/ReportCharts";
import { irmaaRoomPhrase } from "@/lib/irmaaStatus";

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

/** One section. In print, sections flow one after another (no near-empty
 *  pages); `sheet` starts it on a fresh page — the summary and appendices. */
function Page({ children, id, sheet = false }: { children: ReactNode; id?: string; sheet?: boolean }) {
  return (
    <section id={id} className={`report-page${sheet ? " report-sheet" : ""}`}>
      {children}
    </section>
  );
}

function SectionHead({ n, title, lede }: { n: number | string; title: string; lede?: ReactNode }) {
  return (
    <header className="mb-4 border-b-2 pb-2" style={{ borderColor: REPORT_COLORS.primary, breakInside: "avoid", breakAfter: "avoid" }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: REPORT_COLORS.primary }}>
        Section {n}
      </div>
      <h2 className="text-[21px] font-bold leading-tight text-[#0f1f24]">{title}</h2>
      {lede && <p className="mt-1 text-[12.5px] leading-relaxed text-[#45555a]">{lede}</p>}
    </header>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-[14px] font-bold text-[#0f1f24]">{children}</h3>;
}

function P({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mb-2 text-[12.5px] leading-relaxed text-[#26363b] ${className}`}>{children}</p>;
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "good" }) {
  const c = tone === "warn" ? "#b3361f" : tone === "good" ? "#15803d" : REPORT_COLORS.primary;
  return (
    <div className="avoid-break my-3 rounded-md border-l-4 bg-[#f6f8f8] px-3 py-2 text-[12px] leading-relaxed text-[#26363b]" style={{ borderColor: c }}>
      {children}
    </div>
  );
}

function Table({
  head,
  rows,
  align,
  compact = false,
  foot,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  /** "r" for right-aligned (numeric) columns. */
  align?: ("l" | "r")[];
  compact?: boolean;
  foot?: ReactNode[];
}) {
  const cell = compact ? "px-1.5 py-[3px]" : "px-2 py-1.5";
  const a = (i: number) => (align?.[i] === "r" ? "text-right tabular" : "text-left");
  return (
    // Scrolls sideways on a phone preview; prints at full width.
    <div className="overflow-x-auto">
    <table className={`w-full border-collapse ${compact ? "text-[9.5px]" : "text-[11.5px]"}`}>
      <thead>
        <tr className="border-b border-[#cfd8db] bg-[#f1f4f5]">
          {head.map((h, i) => (
            <th key={i} className={`${cell} ${a(i)} font-semibold text-[#3b4b50]`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-[#e8edef]">
            {r.map((c, ci) => (
              <td key={ci} className={`${cell} ${a(ci)} text-[#1d2d32]`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t-2 border-[#cfd8db] font-semibold">
            {foot.map((c, i) => (
              <td key={i} className={`${cell} ${a(i)}`}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md border border-[#dfe5e7] px-3 py-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-[#5b6b70]">{label}</div>
      <div className="tabular mt-0.5 text-[19px] font-bold leading-tight text-[#0f1f24]">{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-snug text-[#5b6b70]">{sub}</div>}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const shortTier = (label: string) => {
  const m = label.match(/Tier (\d)/);
  return m ? `Tier ${m[1]}` : /standard/i.test(label) ? "Standard" : "—";
};

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

export function ClientReport({
  data: d,
  mc,
  prev,
  changes,
  household,
  settings,
  isDemo,
}: {
  data: ReportData;
  mc: MonteCarloResult | null;
  prev: ReviewSnapshot | null;
  changes: SnapshotChange[];
  household: Household;
  settings: PlannerSettings;
  isDemo: boolean;
}) {
  const { ctx } = d;
  const { planConv, activeProj } = ctx;
  const year = ctx.year;
  const spend = planConv.spendingTarget;
  const tax = planConv.tax;
  const draws = planConv.withdrawals;
  const totalDraw = draws.pretax + draws.taxable + draws.roth;
  const conversion = settings.useConversions ? planConv.conversion : 0;
  const prepared = d.now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const pctOf = (v: number) => (d.total > 0 ? Math.round((v / d.total) * 100) : 0);
  const growth =
    settings.spendingStrategy === "flatNominal"
      ? ", held at the same dollar amount each year"
      : settings.spendingStrategy === "guardrails"
        ? ", adjusting with markets inside guardrails"
        : ", rising with inflation to keep your lifestyle steady";
  const survivorNote =
    d.hasSpouse && settings.survivorModel
      ? ` The plan assumes one of you passes around age ${settings.firstDeathAge}, after which the survivor files as single and keeps the larger Social Security check.`
      : "";
  const ssIncome = planConv.fixed.socialSecurity;
  const fixedIncome = ssIncome + planConv.fixed.pension + planConv.fixed.otherIncome + Math.max(0, planConv.fixed.wages - planConv.ficaTax);
  // Dividends & interest taken as cash ("spend" mode): whatever of the year's
  // gross inflow isn't one of the itemized sources, so the table ties out exactly
  // (sources − income tax − payroll tax = cash left to spend).
  const investCash = Math.max(0, planConv.grossInflow - planConv.fixed.socialSecurity - planConv.fixed.pension - planConv.fixed.wages - planConv.fixed.otherIncome - totalDraw);
  const cash = household.accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.balance, 0);
  const pendingSS = d.people.filter((p) => p.pia > 0 && !p.started).sort((a, b) => a.claimYear - b.claimYear);
  const strategyById = Object.fromEntries(d.strategies.map((s) => [s.id, s]));
  const active = d.strategies.find((s) => s.active)!;
  const bestEstate = Math.max(...d.strategies.map((s) => s.estateAfterTax));
  const lowestTax = Math.min(...d.strategies.map((s) => s.lifetimeTax));
  const worstStress = [...d.stress].sort((a, b) => a.minBalance - b.minBalance)[0];
  const successPct = mc ? Math.round(mc.successPct * 100) : null;

  const orderWhy =
    settings.strategy === "smart"
      ? `Each year we take any required withdrawal first, then deliberately pull pre-tax (IRA/401k) dollars up to the top of the ${percent(settings.bracketTarget, 0)} bracket. Those dollars are taxed at today's low rates instead of being forced out later — on top of Social Security — at higher ones. Your brokerage covers the rest, and tax-free Roth is spent last.`
      : settings.strategy === "proportional"
        ? "Each year we take any required withdrawal first, then draw from every account in proportion to its size. It keeps taxable income steady and predictable from year to year."
        : `Each year we take any required withdrawal first, then spend from taxable savings (cash first, then brokerage). Cash isn't taxed, and selling investments taxes only the gain, at the lower capital-gains rate — so your taxable income stays low${conversion > 0.5 ? ", which leaves room to convert pre-tax money to Roth at a low rate" : ""}. Pre-tax comes next, and tax-free Roth is saved for last because it is never forced out and keeps compounding tax-free.`;

  /** One-line "why" per to-do, tied to this household's numbers. */
  const whyFor = (kind: string): string => {
    switch (kind) {
      case "rmd":
        return "Required by law from age " + d.people.map((p) => p.rmdStartAge).filter((v, i, a) => a.indexOf(v) === i).join("/") + "; a shortfall is penalized 25%.";
      case "withdraw":
        return `Fills low tax brackets now so less is forced out at higher rates later.`;
      case "sell":
        return "The cheapest dollars to spend: cash is untaxed and brokerage sales are taxed only on the gain.";
      case "roth":
        return "Tax-free; used only because the other sources are exhausted this year.";
      case "convert":
        return d.conv
          ? `Shrinks your largest future required withdrawal from ${moneyCompact(d.conv.peakRmdBaseline)} to ${moneyCompact(d.conv.peakRmdWithConversions)}${d.conv.estateGain > 0 ? ` and leaves about ${moneyCompact(d.conv.estateGain)} more after all taxes` : ""}.`
          : "Moves pre-tax money to Roth while your tax rate is low.";
      case "tax":
        return d.withholdPct != null
          ? `Simplest: have ${d.withholdPct}% withheld from pre-tax withdrawals — withholding counts as paid evenly all year.`
          : "No paycheck withholding in retirement — quarterly estimates keep you clear of underpayment penalties.";
      default:
        return "";
    }
  };

  const toc = [
    "Executive summary",
    `This quarter: ${d.quarter.label}`,
    `Your ${year} action plan`,
    "Your situation & assumptions",
    "Your portfolio",
    "How we withdraw — and why",
    ...(d.conv && settings.useConversions ? ["Roth conversion strategy"] : []),
    "Social Security",
    `Taxes & Medicare in ${year}`,
    "Lifetime outlook & stress tests",
    "Opportunities & things to watch",
    "Appendix A — Year-by-year projection",
    "Appendix B — Assumptions, methods & disclosures",
  ];
  let sec = 0;
  const nextSec = () => ++sec;

  return (
    <div className="report-doc">
      {/* ================= COVER ================= */}
      <Page id="cover">
        <div className="flex min-h-[9.2in] flex-col">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold tracking-wide" style={{ color: REPORT_COLORS.primary }}>
              Retirement Tax Optimizer
            </div>
            <div className="text-[11px] text-[#5b6b70]">Prepared {prepared}</div>
          </div>
          <div className="mt-[1.3in]">
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: REPORT_COLORS.primary }}>
              Quarterly review · {d.quarter.label}
            </div>
            <h1 className="mt-2 text-[38px] font-bold leading-[1.1] text-[#0f1f24]">Retirement Income &amp; Tax Plan</h1>
            <div className="mt-3 text-[18px] text-[#3b4b50]">Prepared for {d.names}</div>
            <div className="mt-1 text-[12.5px] text-[#5b6b70]">Covers {d.quarter.rangeLabel} and the plan for the rest of {year} and beyond</div>
            {isDemo && (
              <div className="mt-4 inline-block rounded-md border-2 border-[#b3361f] px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-[#b3361f]">
                Example household — not a real client&apos;s plan
              </div>
            )}
          </div>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Stat label="Total savings" value={moneyCompact(d.total)} sub={plural(household.accounts.length, "account")} />
            <Stat label="You can spend" value={`${money(Math.round(spend / 12))}/mo`} sub={`${money(spend)}/yr after tax`} />
            <Stat
              label="Plan confidence"
              value={successPct != null ? `${successPct}%` : "—"}
              sub={`money lasts to ${settings.endAge}`}
            />
            <Stat label={`${year} tax`} value={moneyCompact(ctx.yearTaxTotal)} sub={`federal${d.isIL ? " + Illinois" : ""}`} />
          </div>
          <div className="mt-10">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#5b6b70]">Contents</div>
            <ol className="mt-2 columns-2 gap-8 text-[12px] leading-[1.9] text-[#26363b]">
              {toc.map((t, i) => (
                <li key={t}>
                  <span className="tabular mr-2 text-[#5b6b70]">{t.startsWith("Appendix") ? "" : `${i + 1}.`}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-auto border-t border-[#dfe5e7] pt-3 text-[10px] leading-relaxed text-[#5b6b70]">
            Educational planning estimates, not tax, legal, or investment advice. Figures use {year} federal tax law
            {d.isIL ? " and Illinois state tax" : ""}, your answers in the app, and the balances on file as of {prepared}. Projections
            are estimates, not guarantees. Review with a qualified tax professional before acting.
          </div>
        </div>
      </Page>

      {/* ================= 1. EXECUTIVE SUMMARY ================= */}
      <Page id="summary" sheet>
        <SectionHead n={nextSec()} title="Executive summary" />
        <P>
          {d.names === "You" ? "You have" : `${d.names}, you have`} <strong>{money(d.total)}</strong> saved across{" "}
          {plural(household.accounts.length, "account")}: {pctOf(d.buckets.pretax)}% in pre-tax retirement accounts,{" "}
          {pctOf(d.buckets.roth)}% in Roth, and {pctOf(d.buckets.taxable)}% in taxable brokerage and cash. Your plan funds{" "}
          <strong>{money(spend)}</strong> a year after tax (<strong>{money(Math.round(spend / 12))} a month</strong>){growth},
          through age {settings.endAge}.{survivorNote}
        </P>
        {mc && (
          <P>
            We stress-tested the plan against {mc.runs.toLocaleString()}{" "}simulated market futures, including crashes and
            long slumps. Your savings last through age {settings.endAge} in <strong>{successPct}%</strong> of them
            {successPct! >= 85
              ? " — a comfortable margin."
              : successPct! >= 70
                ? " — solid, but worth watching; small adjustments to spending or Social Security timing move this noticeably."
                : " — below the comfort zone. We recommend revisiting spending, claim ages, or the withdrawal mix (see Section " + (toc.indexOf("Lifetime outlook & stress tests") + 1) + ")."}{" "}
            In the typical (median) future you would leave about <strong>{moneyCompact(mc.endingWealthReal.p50)}</strong>{" "}in
            today&apos;s dollars; in a poor one (10th percentile), about {moneyCompact(mc.endingWealthReal.p10)}.
          </P>
        )}
        <P>
          This year you&apos;ll draw about <strong>{money(totalDraw)}</strong> from savings
          {fixedIncome > 0.5 ? <> on top of {money(fixedIncome)} of income that arrives on its own</> : null}
          {conversion > 0.5 ? (
            <>
              , move <strong>{money(conversion)}</strong> from pre-tax to Roth
            </>
          ) : null}
          , and should set aside about <strong>{money(ctx.yearTaxTotal)}</strong> for income tax. Your withdrawal is{" "}
          {percent(d.withdrawalRate)} of savings
          {d.withdrawalRate <= 0.045
            ? " — at or below the ~4–4.5% pace planners treat as sustainable."
            : d.withdrawalRate <= 0.06
              ? " — a little above the classic ~4% pace; workable, but worth watching."
              : " — well above the ~4% rule of thumb, which is why the confidence figure above matters."}
          {pendingSS.length > 0
            ? ` Withdrawals drop once ${pendingSS[0].name}'s Social Security begins in ${pendingSS[0].claimYear}.`
            : ""}
        </P>

        <H3>Our recommendations</H3>
        <ol className="space-y-2">
          {d.todo
            .filter((t) => t.kind !== "irmaa")
            .map((t, i) => (
              <li key={i} className="avoid-break flex gap-3 rounded-md border border-[#dfe5e7] px-3 py-2">
                <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: REPORT_COLORS.primary }}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-[#0f1f24]">
                    {t.title}
                    {t.deadline && <span className="ml-2 text-[11px] font-semibold text-[#b3361f]">{t.deadline === "Dec 31" ? "by Dec 31" : t.deadline}</span>}
                  </span>
                  <span className="block text-[11.5px] leading-snug text-[#45555a]">{whyFor(t.kind)}</span>
                </span>
              </li>
            ))}
          <li className="avoid-break flex gap-3 rounded-md border border-[#dfe5e7] px-3 py-2">
            <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: REPORT_COLORS.primary }}>
              {d.todo.filter((t) => t.kind !== "irmaa").length + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-[#0f1f24]">
                Revisit the plan next quarter ({d.next.label})
              </span>
              <span className="block text-[11.5px] leading-snug text-[#45555a]">
                Update balances in the app and generate the {d.next.label} review — it will show exactly what changed since this one.
              </span>
            </span>
          </li>
        </ol>

        {prev && changes.length > 0 && (
          <>
            <H3>Since your last review ({prev.quarter.replace("-", " ").replace(/(\d{4}) (Q\d)/, "$2 $1")})</H3>
            <Table
              head={["", "Last review", "Now", "Change"]}
              align={["l", "r", "r", "r"]}
              rows={changes.map((c) => [
                c.label,
                c.before,
                c.after,
                <span key="d" style={{ color: c.tone === "up" ? "#15803d" : c.tone === "down" ? "#b3361f" : "#5b6b70" }}>
                  {c.delta || "no change"}
                </span>,
              ])}
            />
          </>
        )}

        <H3>What we&apos;re watching</H3>
        <ul className="ml-4 list-disc space-y-1 text-[12px] leading-relaxed text-[#26363b]">
          {d.irmaa && !d.irmaa.atTop && (
            <li>
              <strong>Medicare premiums:</strong> this year&apos;s income sits{" "}
              {d.irmaa.inSurcharge ? `in ${d.irmaa.label.toLowerCase()}` : "below the first surcharge line"},{" "}
              {irmaaRoomPhrase(d.irmaa)}, billed in {d.irmaa.billingYear}.
            </li>
          )}
          {worstStress && (
            <li>
              <strong>Bad timing:</strong> in our harshest replay ({worstStress.scenario.name.toLowerCase()}), savings bottom out
              near {moneyCompact(worstStress.minBalance)} at age {worstStress.minBalanceAge}
              {worstStress.depleted ? ` and run short at age ${worstStress.depletionAge}` : " and the plan still holds"}.
            </li>
          )}
          {cash < totalDraw && totalDraw > 0 && (
            <li>
              <strong>Cash cushion:</strong> {money(cash)} in cash covers about {Math.max(0, Math.round((cash / totalDraw) * 12))}{" "}months of
              withdrawals. Many retirees keep 6–12 months in cash so a market drop never forces a sale at a low.
            </li>
          )}
          {d.milestones.slice(0, 3).map((m) => (
            <li key={m.title + m.year}>
              <strong>{m.year}:</strong> {m.title}
            </li>
          ))}
        </ul>
      </Page>

      {/* ================= 2. THIS QUARTER ================= */}
      <Page id="quarter">
        <SectionHead
          n={nextSec()}
          title={`This quarter: ${d.quarter.label}`}
          lede={`${d.quarter.rangeLabel}. The dated deadlines and the seasonal reviews that land in this quarter, then a look at the next one.`}
        />
        {d.agenda.length > 0 ? (
          <Table
            head={["When", "What", "Details"]}
            rows={d.agenda.map((a) => [
              <span key="w" className="whitespace-nowrap font-semibold" style={{ color: a.kind === "deadline" ? "#b3361f" : REPORT_COLORS.primary }}>
                {a.when}
              </span>,
              <strong key="t">{a.title}</strong>,
              a.detail,
            ])}
          />
        ) : (
          <P>No dated deadlines land in this quarter.</P>
        )}

        <H3>Where you should be by now</H3>
        <P>
          It&apos;s {d.pace.monthName}: {Math.round(d.pace.yearFraction * 100)}% of {year}{" "}is behind you. Spreading the year&apos;s plan evenly,
          this is roughly where you&apos;d be today and by the end of the quarter. Lumpier is fine — taxes, RMDs, and conversions
          only care about December 31 totals.
        </P>
        <Table
          head={["", `${year} total`, "Per month", "By today", `By ${d.quarter.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`]}
          align={["l", "r", "r", "r", "r"]}
          rows={[
            ...d.pace.items.map((it) => {
              const qFrac = Math.min(1, d.quarter.q / 4);
              return [it.label, money(Math.round(it.annual)), money(Math.round(it.monthly)), money(Math.round(it.byNow)), money(Math.round(it.annual * qFrac))];
            }),
            ...(conversion > 0.5 ? [["Roth conversion (one move or several)", money(conversion), "—", "—", d.quarter.q === 4 ? money(conversion) : "—"]] : []),
          ]}
        />

        <H3>Looking ahead: {d.next.label}</H3>
        {d.nextAgenda.length > 0 ? (
          <ul className="ml-4 list-disc space-y-1 text-[12px] leading-relaxed text-[#26363b]">
            {d.nextAgenda.map((a) => (
              <li key={a.title}>
                <strong>
                  {a.when === "This quarter" ? "" : `${a.when} — `}
                  {a.title}.
                </strong>{" "}
                {a.detail}
              </li>
            ))}
          </ul>
        ) : (
          <P>Nothing dated lands next quarter beyond keeping to the plan&apos;s pace.</P>
        )}
      </Page>

      {/* ================= 3. ACTION PLAN ================= */}
      <Page id="actions">
        <SectionHead
          n={nextSec()}
          title={`Your ${year} action plan`}
          lede="What to ask your custodian for, from which account, and by when — in the order the plan draws on your money."
        />
        <ol className="space-y-2.5">
          {d.todo.map((t, i) => (
            <li key={i} className="avoid-break rounded-md border border-[#dfe5e7] px-3.5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-bold text-[#0f1f24]">
                  {i + 1}. {t.title}
                </span>
                {t.deadline && <span className="shrink-0 text-[11px] font-semibold text-[#b3361f]">{t.deadline}</span>}
              </div>
              {t.detail && <p className="mt-1 text-[11.5px] leading-relaxed text-[#3b4b50]">{t.detail}</p>}
            </li>
          ))}
        </ol>

        <H3>Where this year&apos;s money comes from</H3>
        <Table
          head={["Source", "Amount", "How it's taxed"]}
          align={["l", "r", "l"]}
          rows={[
            ...(ssIncome > 0.5 ? [["Social Security", money(ssIncome), `${percent(tax.taxableSocialSecurity / ssIncome, 0)} taxable federally`]] : []),
            ...(planConv.fixed.pension > 0.5 ? [["Pension / annuity", money(planConv.fixed.pension), "Ordinary income"]] : []),
            ...(planConv.fixed.wages > 0.5 ? [["Wages", money(planConv.fixed.wages), "Ordinary income"]] : []),
            ...(planConv.fixed.otherIncome > 0.5 ? [["Other income streams", money(planConv.fixed.otherIncome), "Varies by type"]] : []),
            ...(planConv.rmd > 0.5 ? [["Required withdrawals (RMDs)", money(planConv.rmd), "Ordinary income"]] : []),
            ...(draws.pretax - planConv.rmd > 0.5 ? [["Other pre-tax withdrawals", money(draws.pretax - planConv.rmd), "Ordinary income"]] : []),
            ...(draws.taxable > 0.5 ? [["Cash & brokerage", money(draws.taxable), "Cash untaxed; only gains on sales taxed (capital-gains rates)"]] : []),
            ...(draws.roth > 0.5 ? [["Roth", money(draws.roth), "Tax-free"]] : []),
            ...(investCash > 0.5 ? [["Dividends & interest taken as cash", money(investCash), "Qualified dividends at capital-gains rates; the rest as income"]] : []),
            [
              <span key="t" className="text-[#b3361f]">Less: income tax on this income</span>,
              <span key="v" className="text-[#b3361f]">− {money(tax.totalTax - planConv.conversionTax)}</span>,
              planConv.conversionTax > 0.5 ? "The conversion's tax is separate — see below" : `federal${d.isIL ? " + Illinois" : ""}`,
            ],
            ...(planConv.ficaTax > 0.5 ? [["Less: payroll tax on wages", `− ${money(planConv.ficaTax)}`, "Social Security & Medicare tax"]] : []),
          ]}
          foot={["Left to spend", money(planConv.netCash), planConv.netCash - spend > 1 ? `${money(spend)} spending + ${money(planConv.netCash - spend)} reinvested` : ""]}
        />
        {conversion > 0.5 && (
          <P className="mt-2">
            Separately, the <strong>{money(conversion)}</strong>{" "}Roth conversion is not spending — it moves money from pre-tax to Roth.
            It adds about {money(planConv.conversionTax)} to this year&apos;s tax, best paid from cash so the full amount lands in the Roth.
          </P>
        )}
      </Page>

      {/* ================= 4. SITUATION ================= */}
      <Page id="situation">
        <SectionHead n={nextSec()} title="Your situation & assumptions" lede="What the plan is built on. If any of this changes, update it in the app and the plan re-computes." />
        <H3>Household</H3>
        <Table
          head={["", "Born", `Age in ${year}`, "Full retirement age", "Social Security at FRA", "RMDs begin"]}
          align={["l", "r", "r", "r", "r", "r"]}
          rows={d.people.map((p) => [
            <strong key="n">{p.name}</strong>,
            p.birthYear,
            p.age,
            Number.isInteger(p.fra) ? p.fra : `${Math.floor(p.fra)} & ${Math.round((p.fra % 1) * 12)} mo`,
            p.pia > 0 ? `${money(Math.round(p.pia / 12))}/mo` : "—",
            `${p.rmdStartYear} (age ${p.rmdStartAge})`,
          ])}
        />
        <H3>Plan settings</H3>
        <Table
          head={["Setting", "Your choice"]}
          rows={[
            ["Filing status", ctx.filingStatus === "mfj" ? "Married filing jointly" : "Single"],
            ["State", d.stateLabel],
            ["Goal", `${d.goalLabel} — ${d.goalBlurb}`],
            ["Spending", `${money(spend)}/yr after tax${growth.replace(",", " —")}`],
            ["Plan through age", `${settings.endAge}${d.hasSpouse && settings.survivorModel ? ` (survivor modeled from ${settings.firstDeathAge})` : ""}`],
            ["Social Security claim ages", d.people.map((p) => `${p.name} ${p.claimAge}`).join(" · ")],
            ["Withdrawal method", d.strategyLabel],
            ["Roth conversions", settings.useConversions ? `On — ${settings.convertMode === "recommended" ? "sized to your future tax rate" : `fill the ${percent(settings.bracketTarget, 0)} bracket`}, through age ${settings.convertUntilAge}` : "Off"],
            ["Dividends & interest", settings.dividendMode === "spend" ? "Taken as cash to fund spending" : "Reinvested"],
            ["Expected return (after fees)", `${percent(settings.returnRate)} a year, before inflation`],
            ["Inflation", `${percent(settings.inflationRate)} a year`],
            ["Heirs' tax rate on inherited pre-tax", percent(settings.heirTaxRate, 0)],
          ]}
        />
      </Page>

      {/* ================= 5. PORTFOLIO ================= */}
      <Page id="portfolio">
        <SectionHead
          n={nextSec()}
          title="Your portfolio"
          lede={`Balances as of ${prepared}. The tax treatment of each account — not the brand or the fund — drives the withdrawal order.`}
        />
        <AllocationBar
          parts={[
            { label: "Pre-tax", value: d.buckets.pretax, color: REPORT_COLORS.pretax },
            { label: "Taxable", value: d.buckets.taxable, color: REPORT_COLORS.taxable },
            { label: "Roth", value: d.buckets.roth, color: REPORT_COLORS.roth },
          ]}
        />
        <div className="avoid-break mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Stat label="Stocks" value={percent(d.mix.equityPct, 0)} />
          <Stat label="Bonds" value={percent(d.mix.bondPct, 0)} />
          <Stat label="Cash" value={percent(d.mix.cashPct, 0)} />
          <Stat label="Expected return" value={percent(d.mix.expected)} sub={`±${percent(d.mix.volatility, 0)} typical yearly swing`} />
        </div>
        <P className="mt-2 text-[11px] text-[#5b6b70]">
          Mix {d.mix.basis === "holdings" ? "measured from your holdings" : d.mix.basis === "mixed" ? "measured from your holdings where itemized, assumed elsewhere" : "assumed by account type (no holdings itemized)"}.
        </P>

        <H3>Accounts</H3>
        <Table
          head={["Account", "Owner", "Type", "Balance", "Unrealized gain"]}
          align={["l", "l", "l", "r", "r"]}
          rows={d.accounts.map((a) => [
            <span key="l" className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: REPORT_COLORS[a.bucket] }} />
              {a.account.label}
            </span>,
            a.owner,
            a.typeLabel,
            money(a.account.balance),
            a.unrealizedGain != null ? money(a.unrealizedGain) : "—",
          ])}
          foot={["Total", "", "", money(d.total), d.totalUnrealizedGain > 0 ? money(d.totalUnrealizedGain) : ""]}
        />

        {d.accounts.some((a) => a.holdings.length > 0) && <H3>Holdings</H3>}
        {d.accounts
          .filter((a) => a.holdings.length > 0)
          .map((a) => (
            <div key={a.account.id} className="mb-3">
              <div className="avoid-break mb-1 text-[12px] font-semibold text-[#0f1f24]">
                {a.account.label} <span className="font-normal text-[#5b6b70]">· {a.owner} · {money(a.account.balance)}</span>
              </div>
              <Table
                compact
                head={["Ticker", "Name", "Shares", "Price", "Value", "% of acct", ...(a.bucket === "taxable" ? ["Gain"] : [])]}
                align={["l", "l", "r", "r", "r", "r", "r"]}
                rows={a.holdings.map((h) => [
                  <strong key="t">{h.ticker}</strong>,
                  h.name,
                  h.shares.toLocaleString("en-US", { maximumFractionDigits: 3 }),
                  money(h.price, { cents: true }),
                  money(h.value),
                  a.account.balance > 0 ? `${Math.round((h.value / a.account.balance) * 100)}%` : "—",
                  ...(a.bucket === "taxable" ? [h.gain != null ? money(h.gain) : "—"] : []),
                ])}
              />
            </div>
          ))}
        {(() => {
          const all = d.accounts.flatMap((a) => a.holdings.map((h) => ({ ...h, acct: a.account.label })));
          const top = all.sort((x, y) => y.value - x.value)[0];
          const share = top && d.total > 0 ? top.value / d.total : 0;
          return share > 0.15 && top.type === "stock" ? (
            <Note tone="warn">
              <strong>Concentration:</strong> {top.ticker} is {percent(share, 0)}{" "}of your total savings. A single company at that size can move
              the whole plan; consider trimming it over time{d.totalUnrealizedGain > 0 ? ", managing the capital-gains tax across several years" : ""}.
            </Note>
          ) : null;
        })()}
      </Page>

      {/* ================= 6. WITHDRAWAL STRATEGY ================= */}
      <Page id="strategy">
        <SectionHead n={nextSec()} title="How we withdraw — and why" lede={`Your goal is "${d.goalLabel}". The plan picked the withdrawal method that serves it best on your numbers.`} />
        <H3>The three tax buckets</H3>
        <Table
          head={["Bucket", "Your balance", "How withdrawals are taxed", "Forced withdrawals?"]}
          align={["l", "r", "l", "l"]}
          rows={[
            ["Pre-tax (IRA, 401k)", money(d.buckets.pretax), "Every dollar is ordinary income", `Yes — RMDs from ${d.people.map((p) => p.rmdStartAge).filter((v, i, a) => a.indexOf(v) === i).join("/")}`],
            ["Taxable (brokerage, cash)", money(d.buckets.taxable), "Only the gain on sales, at capital-gains rates", "No"],
            ["Roth", money(d.buckets.roth), "Tax-free", "No — never during your lifetime"],
          ]}
        />
        <H3>Your method: {d.strategyLabel}</H3>
        <P>{orderWhy}</P>
        <H3>How the alternatives compare over your lifetime</H3>
        <P>Same household, same spending, same assumptions — only the withdrawal order changes. &ldquo;Left to your family&rdquo; is after every tax, including the income tax still owed on pre-tax money they inherit.</P>
        <Table
          head={["Method", "Lifetime tax", "Left to your family (after tax)", "Lasts to plan age?"]}
          align={["l", "r", "r", "l"]}
          rows={d.strategies.map((s) => [
            <span key="l">
              {s.active ? <strong>{s.label} ✓ your plan</strong> : s.label}
            </span>,
            <span key="t" style={{ color: s.lifetimeTax === lowestTax ? "#15803d" : undefined }}>{moneyCompact(s.lifetimeTax)}</span>,
            <span key="e" style={{ color: s.estateAfterTax === bestEstate ? "#15803d" : undefined }}>{moneyCompact(s.estateAfterTax)}</span>,
            s.depleted ? "No — runs short" : "Yes",
          ])}
        />
        {active && active.estateAfterTax < bestEstate - 1 && (
          <Note>
            Another method leaves more on this single expected-return path. The plan&apos;s pick weighs hundreds of simulated markets
            {settings.goal === "maxCapital" ? " and chooses the method most likely to leave you the most" : ` against your goal (${d.goalLabel.toLowerCase()})`}, so a small single-path gap is expected.
          </Note>
        )}
        {strategyById.smart && strategyById.conventional && (
          <P className="mt-2 text-[11.5px] text-[#5b6b70]">
            Lifetime tax and estate are nominal dollars over the full projection, including Medicare surcharges and the survivor years where modeled.
          </P>
        )}
      </Page>

      {/* ================= 7. ROTH CONVERSIONS ================= */}
      {d.conv && settings.useConversions && (
        <Page id="conversions">
          <SectionHead
            n={nextSec()}
            title="Roth conversion strategy"
            lede={`${Math.round(d.conv.pretaxShare * 100)}% of your savings is pre-tax. Left alone, required withdrawals later would stack on top of Social Security and push you into higher brackets. Converting a slice each year while your rate is low defuses that.`}
          />
          <div className="avoid-break grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Stat label="This year" value={moneyCompact(conversion)} sub={`about ${moneyCompact(planConv.conversionTax)} tax`} />
            <Stat label="Over the window" value={moneyCompact(d.conv.totalConverted)} sub={`${plural(d.conv.windowYears, "year")}, through ${d.conv.windowEndYear}`} />
            <Stat label="Biggest RMD" value={moneyCompact(d.conv.peakRmdWithConversions)} sub={`instead of ${moneyCompact(d.conv.peakRmdBaseline)}`} />
            <Stat label="Family keeps" value={`${d.conv.estateGain >= 0 ? "+" : "−"}${moneyCompact(Math.abs(d.conv.estateGain))}`} sub="after all taxes, vs. not converting" />
          </div>
          <H3>Why it works for you</H3>
          <P>
            Each conversion is taxed now, at a rate we deliberately keep below the rate your future required withdrawals would face. The converted
            money then grows tax-free with no required withdrawals ever, and heirs inherit it tax-free.
            {d.isIL ? " Illinois doesn't tax conversions at all, so you pay only the federal tax." : ""}
            {d.conv.lifetimeTaxDelta > 0
              ? ` Converting raises lifetime tax by about ${moneyCompact(d.conv.lifetimeTaxDelta)} on paper, but ${d.conv.estateGain > 0 ? "still leaves your family more after tax because the Roth compounds untaxed" : "buys much lower late-life taxable income and flexibility"}.`
              : ` It also lowers lifetime tax by about ${moneyCompact(Math.abs(d.conv.lifetimeTaxDelta))}.`}
          </P>
          <H3>How to do it</H3>
          <ul className="ml-4 list-disc space-y-1 text-[12px] leading-relaxed text-[#26363b]">
            <li>Ask your custodian for a <strong>&ldquo;Roth conversion&rdquo;</strong> (not a rollover) from a traditional IRA to a Roth IRA, by December 31.</li>
            <li>Decline withholding on the conversion and pay its tax from cash — withholding shrinks what lands in the Roth.</li>
            <li>Each conversion starts its own five-year clock before the converted amount can come out penalty-free if you&apos;re under 59½; after 59½ this rarely matters.</li>
            <li>Re-check the size in December against your actual year-end income, especially near a Medicare (IRMAA) line.</li>
          </ul>
          {d.convSchedule.length > 0 && (
            <>
              <H3>The planned schedule</H3>
              <Table
                compact
                head={["Year", "Age", "Convert", "Top bracket reached", "Medicare tier (billed 2 yrs later)"]}
                align={["l", "r", "r", "r", "l"]}
                rows={d.convSchedule.map((r) => [r.year, r.age, money(r.amount), percent(r.marginalRate, 0), shortTier(r.irmaaLabel)])}
              />
              <P className="mt-1 text-[11px] text-[#5b6b70]">Future amounts re-size every year with your actual balances and income — treat them as the plan&apos;s current estimate.</P>
            </>
          )}
        </Page>
      )}

      {/* ================= 8. SOCIAL SECURITY ================= */}
      <Page id="social-security">
        <SectionHead n={nextSec()} title="Social Security" lede="Often the single biggest lever in a retirement plan: claiming later means a larger, inflation-protected check for life." />
        {d.people.some((p) => p.pia > 0) ? (
          <>
            <Table
              head={["Claim at", ...d.people.filter((p) => p.pia > 0).map((p) => `${p.name} (per year)`)]}
              align={["l", ...d.people.filter((p) => p.pia > 0).map(() => "r" as const)]}
              rows={d.people[0].byAge.map((_, i) =>
                [
                  `Age ${d.people[0].byAge[i].age}`,
                  ...d.people
                    .filter((p) => p.pia > 0)
                    .map((p) => {
                      const v = p.byAge[i];
                      const chosen = v.age === Math.round(p.claimAge);
                      return chosen ? <strong key={p.who}>{money(Math.round(v.annual))} ✓</strong> : money(Math.round(v.annual));
                    }),
                ],
              )}
            />
            <H3>Your plan</H3>
            <ul className="ml-4 list-disc space-y-1 text-[12px] leading-relaxed text-[#26363b]">
              {d.people
                .filter((p) => p.pia > 0)
                .map((p) => (
                  <li key={p.who}>
                    <strong>{p.name}</strong> claims at {p.claimAge} — about {money(Math.round(p.chosenAnnual / 12))}/mo
                    {p.started ? " (already receiving)" : `, starting ${p.claimYear}`}.
                    {p.breakeven62v70 ? ` Waiting until 70 instead of 62 pays off if ${p.name === "You" ? "you live" : "they live"} past about age ${Math.round(p.breakeven62v70)}.` : ""}
                  </li>
                ))}
            </ul>
            {d.hasSpouse && (
              <Note>
                <strong>The survivor angle:</strong> when one of you passes, the survivor keeps the <em>larger</em>{" "}of your two checks. Delaying the
                higher earner&apos;s claim therefore raises the income that lasts as long as either of you lives — often the strongest reason to wait.
              </Note>
            )}
            <P className="text-[11px] text-[#5b6b70]">
              Amounts are in today&apos;s dollars before cost-of-living adjustments; the projection grows them with inflation. The app&apos;s Social
              Security step shows what a different claim age would be worth over your lifetime.
            </P>
          </>
        ) : (
          <P>No Social Security benefit is entered. If either of you expects one, add the amount from your SSA statement in the app — it materially changes the plan.</P>
        )}
      </Page>

      {/* ================= 9. TAXES & MEDICARE ================= */}
      <Page id="taxes">
        <SectionHead n={nextSec()} title={`Taxes & Medicare in ${year}`} lede="This year's estimated tax return, line by line, including the Roth conversion." />
        <div className="avoid-break grid gap-6 sm:grid-cols-2">
          <Table
            head={["", "Amount"]}
            align={["l", "r"]}
            rows={[
              ["Adjusted gross income", money(tax.agi)],
              ["Taxable Social Security", money(tax.taxableSocialSecurity)],
              ["Deductions", `− ${money(tax.deductions)}`],
              [<strong key="t">Taxable income</strong>, <strong key="v">{money(tax.taxableIncome)}</strong>],
              ["Ordinary income tax", money(tax.ordinaryTax)],
              ["Capital-gains & qualified-dividend tax", money(tax.capitalGainsTax)],
              ...(tax.niit > 0 ? [["Net investment income tax (3.8%)", money(tax.niit)]] : []),
              ["Federal total", money(tax.federalTax)],
              [`${tax.state.stateName} tax`, money(tax.stateTax)],
            ]}
            foot={["Total income tax", money(tax.totalTax)]}
          />
          <div>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Effective rate" value={percent(tax.effectiveRate)} sub="average across all income" />
              <Stat label="Top bracket" value={percent(tax.marginalOrdinaryRate, 0)} sub="on the next ordinary dollar" />
              <Stat label="Capital-gains rate" value={percent(tax.capitalGainsRate, 0)} sub="on the next gain dollar" />
              <Stat label="True marginal cost" value={percent(tax.effectiveMarginalRate, 0)} sub="incl. SS taxation & phase-outs" />
            </div>
            {d.isIL && (
              <P className="mt-3 text-[11.5px]">
                Illinois taxes only investment income (interest, dividends, gains) at 4.95%. IRA and 401(k) withdrawals, RMDs, Roth
                conversions, pensions, and Social Security are all exempt.
              </P>
            )}
          </div>
        </div>
        <H3>Paying the tax</H3>
        <P>
          {d.withholdPct != null ? (
            <>
              The simplest route: have your custodian withhold about <strong>{d.withholdPct}%</strong>{" "}federal tax from your pre-tax withdrawals.
              Withholding counts as paid evenly through the year, whenever it actually happens. Alternatively, pay four estimates of about{" "}
              {money(Math.round(ctx.yearTaxTotal / 4))} with Form 1040-ES (Apr 15, Jun 15, Sep 15, Jan 15).
            </>
          ) : (
            <>
              Pay four estimated-tax installments of about <strong>{money(Math.round(ctx.yearTaxTotal / 4))}</strong>{" "}with Form 1040-ES
              (Apr 15, Jun 15, Sep 15, Jan 15)
              {d.isIL ? ", plus Illinois installments (IL-1040-ES) if you'll owe the state more than $1,000" : ""}.
            </>
          )}{" "}
          No-penalty shortcut: if withholding plus estimates reach 100% of last year&apos;s total tax (110% if last year&apos;s income topped
          $150,000), there is no underpayment penalty even if you owe more in April.
        </P>
        {d.irmaa && (
          <>
            <H3>Medicare premiums (IRMAA)</H3>
            <P>
              Medicare sets each year&apos;s Part B and D premiums from your income two years earlier. This year&apos;s income (MAGI) of{" "}
              <strong>{money(Math.round(d.irmaa.magi))}</strong> sets your {d.irmaa.billingYear} premiums
              {d.irmaa.inSurcharge
                ? ` at ${d.irmaa.label.toLowerCase()} — about ${money(Math.round(d.irmaa.perPersonMonthly))}/mo per person above the standard premium (${money(Math.round(d.irmaa.householdAnnual))}/yr for the household).`
                : " with no surcharge."}
              {!d.irmaa.atTop ? ` This year's income is ${irmaaRoomPhrase(d.irmaa)} — and a line crossed by even $1 costs the full step.` : ""}
              {d.irmaa.inWindow ? " You aren't on Medicare yet, but this year's income already sets your first premium at 65." : ""}
            </P>
            <P className="text-[11.5px] text-[#5b6b70]">
              Just stopped working? Your first premiums may be based on your old paycheck. Social Security&apos;s Form SSA-44 (&ldquo;work
              stoppage&rdquo;) asks them to use your lower retirement income instead. The surcharge is deducted from your Social Security check.
            </P>
          </>
        )}
      </Page>

      {/* ================= 10. LIFETIME OUTLOOK ================= */}
      <Page id="outlook">
        <SectionHead n={nextSec()} title="Lifetime outlook & stress tests" lede={`How your savings are projected to evolve through age ${settings.endAge}, and how the plan holds up when markets don't cooperate.`} />
        <H3>Your savings by tax bucket, on the expected path</H3>
        <BalancesChart
          rows={d.rows.map((r) => ({
            year: r.year,
            age: r.selfAge,
            pretax: r.startBalances.pretax,
            taxable: r.startBalances.taxable,
            roth: r.startBalances.roth,
          }))}
        />
        <P className="mt-2">
          Pre-tax shrinks as conversions and required withdrawals draw it down; Roth grows untaxed. On the expected path you&apos;d leave about{" "}
          <strong>{moneyCompact(activeProj.endingEstateAfterTaxReal)}</strong> after tax in today&apos;s dollars ({moneyCompact(activeProj.endingEstateAfterTax)}{" "}in
          future dollars), having paid about {moneyCompact(activeProj.lifetimeTax)} in lifetime tax.
        </P>
        {mc && (
          <>
            <H3>Across {mc.runs.toLocaleString()} simulated market futures</H3>
            <OutcomeFan band={mc.bandReal} />
            <Table
              head={["Plan holds to " + settings.endAge, "Poor markets (10th pct)", "Typical (median)", "Strong markets (90th pct)"]}
              align={["l", "r", "r", "r"]}
              rows={[
                [
                  <strong key="s">
                    {successPct}% <span className="font-normal text-[#5b6b70]">({Math.round(mc.successCI[0] * 100)}–{Math.round(mc.successCI[1] * 100)}%)</span>
                  </strong>,
                  moneyCompact(mc.endingWealthReal.p10),
                  moneyCompact(mc.endingWealthReal.p50),
                  moneyCompact(mc.endingWealthReal.p90),
                ],
              ]}
            />
            <P className="mt-1 text-[11px] text-[#5b6b70]">
              Ending savings in today&apos;s dollars. Simulation draws stock, bond, and cash returns around a {percent(mc.expectedReturn)}{" "}expected return
              with ±{percent(mc.volatility, 0)} yearly volatility, plus variable inflation.
              {mc.medianShortfallAge > 0 ? ` In the futures that fall short, money typically runs out around age ${Math.round(mc.medianShortfallAge)}.` : ""}
            </P>
          </>
        )}
        <H3>Stress tests: bad luck at the worst time</H3>
        <Table
          head={["Scenario", "Lowest balance", "Holds to " + settings.endAge + "?", "Left after tax"]}
          align={["l", "r", "l", "r"]}
          rows={d.stress.map((s) => [
            <span key="n">
              <strong>{s.scenario.name}</strong>
              <span className="block text-[10.5px] text-[#5b6b70]">{s.scenario.description}</span>
            </span>,
            `${moneyCompact(s.minBalance)} at ${s.minBalanceAge}`,
            s.depleted ? <span key="d" className="font-semibold text-[#b3361f]">Short at {s.depletionAge}</span> : "Yes",
            moneyCompact(s.endingEstateAfterTax),
          ])}
        />
        {d.lookAhead.length > 0 && (
          <>
            <H3>The next five years</H3>
            <Table
              compact
              head={["Year", "Ages", "What to do", "Est. tax"]}
              align={["l", "l", "l", "r"]}
              rows={d.lookAhead.map((y) => [
                y.year,
                d.hasSpouse ? `${y.selfAge}/${y.spouseAge}` : y.selfAge,
                <span key="a">
                  {y.events.length > 0 && <strong className="block">{y.events.join(" · ")}</strong>}
                  {y.actions.map((a) => a.text).join("; ")}
                </span>,
                moneyCompact(y.tax),
              ])}
            />
          </>
        )}
      </Page>

      {/* ================= 11. OPPORTUNITIES ================= */}
      <Page id="opportunities">
        <SectionHead n={nextSec()} title="Opportunities & things to watch" lede="Optional moves that could lower your tax, and the years when the plan changes gear." />
        {d.opportunities.length > 0 ? (
          <div className="space-y-2">
            {d.opportunities.map((o) => (
              <div key={o.id} className="avoid-break rounded-md border border-[#dfe5e7] px-3 py-2">
                <div className="text-[12.5px] font-semibold text-[#0f1f24]">
                  {o.title}
                  {o.impact && <span className="ml-2 text-[11px] font-semibold text-[#15803d]">{o.impact}</span>}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#3b4b50]">{o.detail}</p>
                {o.sources.length > 0 && <p className="mt-0.5 text-[10px] text-[#5b6b70]">Source: {o.sources.map((s) => s.label).join(" · ")}</p>}
              </div>
            ))}
          </div>
        ) : (
          <P>No additional opportunities stand out at your current numbers.</P>
        )}
        {d.milestones.length > 0 && (
          <>
            <H3>Milestones ahead</H3>
            <Table
              compact
              head={["Year", "Age", "Milestone", "What it means"]}
              align={["l", "r", "l", "l"]}
              rows={d.milestones.map((m) => [m.year, m.age, <strong key="t">{m.title}</strong>, m.detail])}
            />
          </>
        )}
      </Page>

      {/* ================= APPENDIX A ================= */}
      <Page id="appendix-a" sheet>
        <SectionHead n="A" title="Year-by-year projection" lede="The expected-return path in nominal (future) dollars. Withdrawals are gross of tax; the Roth conversion is shown separately because it isn't spending." />
        <Table
          compact
          head={["Year", "Ages", "Spending", "Soc. Sec.", "Pre-tax out", "of which RMD", "Taxable out", "Roth out", "Roth conv.", "Total tax", "Medicare", "End balance"]}
          align={["l", "l", "r", "r", "r", "r", "r", "r", "r", "r", "l", "r"]}
          rows={d.rows.map((r) => [
            r.year,
            d.hasSpouse ? `${r.selfAge}/${r.spouseAge}` : r.selfAge,
            moneyCompact(r.spendingTarget),
            r.socialSecurity > 0.5 ? moneyCompact(r.socialSecurity) : "—",
            r.fromPretax > 0.5 ? moneyCompact(r.fromPretax) : "—",
            r.rmd > 0.5 ? moneyCompact(r.rmd) : "—",
            r.fromTaxable > 0.5 ? moneyCompact(r.fromTaxable) : "—",
            r.fromRoth > 0.5 ? moneyCompact(r.fromRoth) : "—",
            r.conversion > 0.5 ? moneyCompact(r.conversion) : "—",
            moneyCompact(r.tax),
            shortTier(r.irmaaLabel),
            <span key="e" style={{ color: r.shortfall ? "#b3361f" : undefined }}>{moneyCompact(r.endTotal)}</span>,
          ])}
        />
      </Page>

      {/* ================= APPENDIX B ================= */}
      <Page id="appendix-b">
        <SectionHead n="B" title="Assumptions, methods & disclosures" />
        <ul className="ml-4 list-disc space-y-1.5 text-[11.5px] leading-relaxed text-[#26363b]">
          <li>
            <strong>Tax law.</strong> {year}{" "}federal brackets, standard and age-65 deductions, the 2025–2028 senior deduction, long-term capital-gains
            stacking, taxation of Social Security, the 3.8% net investment income tax, and Medicare IRMAA tiers with the two-year lookback
            {d.isIL ? ", plus Illinois' 4.95% flat tax with its retirement-income exemption" : ""}. Brackets and thresholds are indexed with inflation in
            future years.
          </li>
          <li>
            <strong>Required minimum distributions</strong>{" "}follow the IRS Uniform Lifetime Table, starting at 73 (born 1951–1959) or 75 (born 1960+), each
            spouse from their own accounts. Roth IRAs have no lifetime RMDs.
          </li>
          <li>
            <strong>Projection.</strong> A deterministic year-by-year model at {percent(settings.returnRate)} return and {percent(settings.inflationRate)}{" "}inflation
            through age {settings.endAge}, applying your withdrawal method, conversions, Social Security claim ages, and spending rule each year.
          </li>
          <li>
            <strong>Monte Carlo.</strong> {mc ? `${mc.runs.toLocaleString()} simulated futures` : "Simulated futures"}{" "}drawing correlated stock, bond, and cash
            returns from capital-market assumptions for your asset mix, with stochastic inflation. &ldquo;Plan confidence&rdquo; is the share of futures that fund full
            spending to age {settings.endAge}; the range shown is a 95% confidence interval.
          </li>
          <li>
            <strong>After-tax estate</strong> discounts inherited pre-tax money at a {percent(settings.heirTaxRate, 0)}{" "}heir tax rate (the SECURE Act 10-year rule)
            and taxable gains at 15%; Roth passes tax-free.
          </li>
          <li>
            <strong>Not modeled:</strong>{" "}long-term-care costs, home equity, estate and gift tax, state taxes other than Illinois, and changes in tax law
            after {year}. Holdings are valued at the latest prices available when this report was prepared.
          </li>
        </ul>
        <Note tone="warn">
          This report is an educational planning estimate prepared from information you provided. It is not tax, legal, or investment advice, and it is
          not an offer to buy or sell any security. Projections are hypothetical, do not reflect actual investment results, and are not guarantees of
          future results. Review any action with a qualified tax professional before acting.
        </Note>
        <P className="mt-4 text-[11px] text-[#5b6b70]">
          Your next review: <strong>{d.next.label}</strong> ({d.next.rangeLabel}). Update your balances in the app at the start of the quarter and generate a
          new report — it will compare against this one.
        </P>
      </Page>
    </div>
  );
}
