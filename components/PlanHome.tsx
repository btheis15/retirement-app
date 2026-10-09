"use client";

/**
 * The Plan tab's "home" building blocks — the action-first layout:
 *
 *   1. PlanHero     — the year in one glance (spend / withdraw / tax / convert, and
 *                     whether the plan holds up).
 *   2. TodoList     — what to do, in order, with the named account each dollar comes
 *                     from (lib/checklist — the same custodian-ready list the
 *                     walkthrough's finale previews), deadlines, and "Mark done".
 *   3. ComingUp     — the dates and life events ahead (deadlines this year, Social
 *                     Security starting, RMDs beginning, Medicare at 65).
 *   4. WhyCard      — one short reason per decision, with the detail one tap away.
 *   5. YourAnswers  — every walkthrough answer, each one tap from its step.
 *
 * Pure display: every number is passed in from the engine via app/plan/page.tsx.
 */

import { ReactNode, useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui";
import { ChecklistItem } from "@/lib/checklist";
import { YearPace } from "@/lib/pace";
import { MonteCarloResult } from "@/lib/monteCarlo";
import { Household, otherIncomeForYear, wageForYear } from "@/lib/accounts";
import { PlannerSettings } from "@/lib/defaults";
import { GOAL_META } from "@/lib/goals";
import { rmdStartAge } from "@/lib/tax/constants";
import { adjustedAnnualBenefit } from "@/lib/socialSecurity";
import { money, moneyCompact } from "@/lib/format";

/** Same deep-link shape as GuidedPlan's adjustHref (kept local so this module
 *  doesn't pull the whole walkthrough into the Plan tab's bundle). */
const adjustHref = (step: string) => `/?step=${step}`;

/* ------------------------------------------------------------------ */
/* 1. Hero                                                             */
/* ------------------------------------------------------------------ */

export function PlanHero({
  year,
  spending,
  totalDraw,
  yearTax,
  conversion,
  confidence,
  endAge,
  isDemo,
}: {
  year: number;
  spending: number;
  totalDraw: number;
  yearTax: number;
  conversion: number;
  confidence: MonteCarloResult | null;
  endAge: number;
  isDemo: boolean;
}) {
  const pct = confidence?.successPct ?? null;
  const verdict =
    pct == null
      ? { dot: "bg-white/50", text: "Checking how your plan holds up across hundreds of markets…" }
      : pct >= 0.85
        ? { dot: "bg-[#7ee2a8]", text: `On track — your money lasts to ${endAge} in about ${Math.round(pct * 10)} of 10 market futures` }
        : pct >= 0.7
          ? { dot: "bg-[#f4c870]", text: `Solid, worth watching — lasts to ${endAge} in about ${Math.round(pct * 10)} of 10 market futures` }
          : { dot: "bg-[#f59d8a]", text: `Needs a look — lasts to ${endAge} in only about ${Math.round(pct * 10)} of 10 market futures` };
  const stats: { label: string; value: string }[] = [
    { label: "Withdraw", value: totalDraw > 0.5 ? moneyCompact(totalDraw) : "$0" },
    { label: "Set aside for tax", value: moneyCompact(yearTax) },
    conversion > 0.5 ? { label: "Move to Roth", value: moneyCompact(conversion) } : { label: "Plan runs to", value: `age ${endAge}` },
  ];
  return (
    <section
      className="relative overflow-hidden rounded-3xl p-5 text-white"
      style={{
        background: "linear-gradient(140deg, #0b3f3b 0%, #0d4f4a 45%, #13756c 100%)",
        boxShadow: "0 2px 6px rgba(13,79,74,0.18), 0 18px 40px rgba(13,79,74,0.22)",
      }}
    >
      {/* soft gold glow — decoration only */}
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full" style={{ background: "radial-gradient(circle, rgba(177,121,31,0.35), transparent 70%)" }} />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/65">
            Your {year} plan{isDemo ? " · example" : ""}
          </span>
          <Link href={adjustHref("spend")} className="press rounded-full bg-white/12 px-3 py-1 text-[12px] font-semibold text-white ring-1 ring-white/20">
            Adjust
          </Link>
        </div>
        <div className="mt-3 text-[14px] text-white/75">You can spend</div>
        <div className="tabular text-[40px] font-bold leading-none tracking-tight">
          {money(Math.round(spending / 12))}
          <span className="ml-1 text-lg font-semibold text-white/70">/mo</span>
        </div>
        <div className="mt-1 text-[13px] text-white/60">{money(spending)} this year, after tax</div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-white/15 rounded-2xl bg-white/[0.08] py-2.5 ring-1 ring-white/10">
          {stats.map((s) => (
            <div key={s.label} className="px-2 text-center">
              <div className="tabular text-[17px] font-bold">{s.value}</div>
              <div className="text-[11px] leading-tight text-white/60">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2 text-[13px] leading-snug text-white/85">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${verdict.dot}`} />
          <span>
            {verdict.text}
            {pct != null && pct < 0.85 && (
              <>
                {" "}
                <Link href={adjustHref("spend")} className="font-semibold text-white underline decoration-white/40 underline-offset-2">
                  See what would help →
                </Link>
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. To-do list                                                       */
/* ------------------------------------------------------------------ */

const TODO_ICON: Record<ChecklistItem["kind"], string> = {
  rmd: "📌",
  withdraw: "🏦",
  sell: "💵",
  roth: "🌱",
  convert: "🔁",
  tax: "🧾",
  irmaa: "🏥",
};

/** Which "Mark done" record a checklist item maps to (null = informational). */
export type DoneStep = "rmd" | "pretax" | "taxable" | "roth" | "conversion";
export function doneStepOf(kind: ChecklistItem["kind"]): DoneStep | null {
  switch (kind) {
    case "rmd":
      return "rmd";
    case "withdraw":
      return "pretax";
    case "sell":
      return "taxable";
    case "roth":
      return "roth";
    case "convert":
      return "conversion";
    default:
      return null;
  }
}

export function TodoList({
  items,
  year,
  pace,
  canMarkDone,
  doneRecords,
  onMarkDone,
}: {
  items: (ChecklistItem & { doneKey?: string })[];
  year: number;
  pace: YearPace;
  canMarkDone: boolean;
  doneRecords: Record<string, { at: number; amount: number }> | undefined;
  onMarkDone: (item: ChecklistItem & { doneKey: string }) => void;
}) {
  const draw = pace.items.find((i) => i.tone === "taxable");
  const tax = pace.items.find((i) => i.tone === "tax");
  return (
    <div className="print-area">
      <div className="hidden print:block">
        <div className="text-lg font-bold">Your {year} plan — what to do, in order</div>
        <div className="mb-2 text-[12px] text-foreground/60">
          Prepared {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · educational
          estimates, not tax advice
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-[14px] text-foreground/75" style={{ boxShadow: "var(--shadow-card)" }}>
          ✅ Nothing to withdraw this year — your income covers your spending. Any surplus can stay invested.
        </div>
      ) : (
        <ol className="space-y-2.5">
          {items.map((it, i) => {
            const done = it.doneKey ? doneRecords?.[`${year}:${it.doneKey}`] : undefined;
            return (
              <TodoItem
                key={`${it.kind}-${i}`}
                n={i + 1}
                item={it}
                done={done}
                canMarkDone={canMarkDone && !!it.doneKey}
                onMarkDone={() => it.doneKey && onMarkDone({ ...it, doneKey: it.doneKey })}
              />
            );
          })}
        </ol>
      )}
      {(draw || tax) && pace.yearFraction > 0.04 && pace.yearFraction < 0.99 && (
        <p className="mt-3 rounded-xl bg-primary/[0.05] px-3 py-2 text-[13px] leading-snug text-foreground/70 print:hidden">
          🗓️ <strong>Where you should be by now</strong> ({pace.monthName}, {Math.round(pace.yearFraction * 100)}% through the
          year): on a steady pace, about{" "}
          {draw && <strong>{moneyCompact(draw.byNow)} withdrawn</strong>}
          {draw && tax && " and "}
          {tax && <strong>{moneyCompact(tax.byNow)} set aside for tax</strong>}. Lumpier is fine — the Dec 31 totals are what count.
        </p>
      )}
      <button
        onClick={() => window.print()}
        className="press mt-2 w-full rounded-xl px-4 py-2 text-[13px] font-semibold text-foreground/55 print:hidden"
      >
        🖨️ Print this list or save as PDF — bring it to your custodian or CPA
      </button>
    </div>
  );
}

function TodoItem({
  n,
  item,
  done,
  canMarkDone,
  onMarkDone,
}: {
  n: number;
  item: ChecklistItem;
  done?: { at: number; amount: number };
  canMarkDone: boolean;
  onMarkDone: () => void;
}) {
  // Short instructions read inline; long "how" text (custodian wording, tax
  // mechanics) sits one tap away so the list scans as a list.
  const long = (item.detail?.length ?? 0) > 150;
  const [open, setOpen] = useState(false);
  return (
    <li className="rise rounded-2xl border border-border bg-card p-3.5" style={{ boxShadow: "var(--shadow-card)", ["--i" as string]: n - 1 } as React.CSSProperties}>
      <div className="flex gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${done ? "bg-gain" : "bg-primary"}`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`text-[15px] font-semibold leading-snug ${done ? "text-foreground/45 line-through decoration-foreground/25" : ""}`}>
            <span aria-hidden className="mr-1">{TODO_ICON[item.kind]}</span>
            {item.title}
          </div>
          {item.deadline && !done && (
            <div className="mt-1">
              <Pill tone={item.deadline === "Dec 31" ? "tax" : "default"}>
                {item.deadline === "Dec 31" ? "Due Dec 31" : item.deadline}
              </Pill>
            </div>
          )}
          {item.detail && (!long || open) && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/65">{item.detail}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden">
            {long && (
              <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[12px] font-semibold text-primary">
                {open ? "Hide details" : "How to do it ›"}
              </button>
            )}
            {done ? (
              <span className="text-[12px] font-medium text-gain">
                ✓ Done {new Date(done.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} — {money(done.amount)} recorded
              </span>
            ) : (
              canMarkDone && (
                <button onClick={onMarkDone} className="text-[12px] font-semibold text-foreground/55 underline decoration-foreground/20 underline-offset-2">
                  ✓ I did this
                </button>
              )
            )}
          </div>
          {/* Print always shows the full instruction. */}
          {long && !open && item.detail && <p className="hidden text-[12px] print:block">{item.detail}</p>}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Coming up                                                        */
/* ------------------------------------------------------------------ */

export interface TimelineEntry {
  when: string;
  title: string;
  sub?: string;
  /** "soon" = a dated deadline within ~45 days. */
  tone: "soon" | "date" | "life";
}

/** This year's dated deadlines + the life events ahead that change the plan. */
export function buildTimeline(
  household: Household,
  settings: PlannerSettings,
  pace: YearPace,
  year: number,
  lastConversionYear: number | null,
): TimelineEntry[] {
  const out: TimelineEntry[] = pace.deadlines.slice(0, 3).map((d) => ({
    when: d.when,
    title: d.label,
    sub: d.inDays <= 45 ? `in ${d.inDays} day${d.inDays === 1 ? "" : "s"}` : undefined,
    tone: d.inDays <= 45 ? "soon" : "date",
  }));
  const hasSpouse = household.spouse && household.spouse.birthYear > 1900;
  const life: (TimelineEntry & { y: number })[] = [];
  for (const who of ["self", "spouse"] as const) {
    if (who === "spouse" && !hasSpouse) continue;
    const p = household[who];
    const name = p.label || (who === "self" ? "You" : "Spouse");
    // The single-household default label is literally "You" — conjugate for it.
    const isYou = name === "You";
    const poss = isYou ? "Your" : `${name}'s`;
    const ssYear = p.birthYear + p.ssClaimAge;
    if (p.socialSecurityAnnual > 0 && ssYear > year) {
      const yr = adjustedAnnualBenefit(p.socialSecurityAnnual, p.birthYear, p.ssClaimAge);
      life.push({ y: ssYear, when: String(ssYear), title: `${name} ${isYou ? "start" : "starts"} Social Security`, sub: `about ${money(Math.round(yr / 12))}/mo — withdrawals shrink`, tone: "life" });
    }
    const medYear = p.birthYear + 65;
    if (medYear > year) life.push({ y: medYear, when: String(medYear), title: `${name} ${isYou ? "turn" : "turns"} 65 — Medicare`, sub: "income from 2 years earlier sets the premium", tone: "life" });
    const rmdYear = p.birthYear + rmdStartAge(p.birthYear);
    if (rmdYear > year) life.push({ y: rmdYear, when: String(rmdYear), title: `${poss} required withdrawals (RMDs) begin`, sub: `at age ${rmdStartAge(p.birthYear)}`, tone: "life" });
  }
  if (settings.useConversions && lastConversionYear && lastConversionYear > year) {
    life.push({ y: lastConversionYear, when: String(lastConversionYear), title: "Last planned Roth conversion", sub: `through age ${settings.convertUntilAge}`, tone: "life" });
  }
  life.sort((a, b) => a.y - b.y);
  return [...out, ...life.slice(0, 4)];
}

export function ComingUp({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3" style={{ boxShadow: "var(--shadow-card)" }}>
      <ol className="relative">
        {entries.map((e, i) => (
          <li key={`${e.when}-${e.title}`} className="relative flex gap-3 pb-3 last:pb-0">
            {/* rail */}
            {i < entries.length - 1 && <span aria-hidden className="absolute left-[33px] top-6 h-[calc(100%-12px)] w-px bg-border" />}
            <span
              className={`tabular relative z-10 w-[68px] shrink-0 rounded-lg px-1.5 py-1 text-center text-[12px] font-bold ${
                e.tone === "soon" ? "bg-tax/10 text-tax" : e.tone === "date" ? "bg-primary/10 text-primary" : "bg-ss/10 text-ss"
              }`}
            >
              {e.when}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[14px] font-semibold leading-snug">{e.title}</span>
              {e.sub && <span className="block text-[12px] leading-snug text-foreground/55">{e.sub}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Why                                                              */
/* ------------------------------------------------------------------ */

export function WhyCard({
  icon,
  title,
  children,
  more,
  action,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  /** Optional deeper explanation, revealed on tap. */
  more?: ReactNode;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-lg">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug">{title}</div>
          <div className="mt-1 text-[13px] leading-relaxed text-foreground/70">{children}</div>
          {(more || action) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {more && (
                <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-[12px] font-semibold text-primary">
                  {open ? "Show less" : "Tell me more ›"}
                </button>
              )}
              {action}
            </div>
          )}
          {more && open && <div className="rise mt-2 text-[13px] leading-relaxed text-foreground/65">{more}</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Your answers                                                     */
/* ------------------------------------------------------------------ */

export interface AnswerRow {
  label: string;
  value: string;
  step: string;
}

/** Every walkthrough decision, in plain words, each mapped to its step. */
export function buildAnswers(household: Household, settings: PlannerSettings, year: number): AnswerRow[] {
  const hasSpouse = !!household.spouse && household.spouse.birthYear > 1900;
  const people = hasSpouse ? `${household.self.label || "You"} & ${household.spouse.label || "Spouse"}` : household.self.label || "You";
  const growth =
    settings.spendingStrategy === "flatNominal" ? "flat dollars" : settings.spendingStrategy === "guardrails" ? "guardrails" : "rises with inflation";
  const total = household.accounts.reduce((s, a) => s + a.balance, 0);
  const rows: AnswerRow[] = [
    { label: "Household", value: `${people} · born ${household.self.birthYear}${hasSpouse ? ` / ${household.spouse.birthYear}` : ""}`, step: "aboutyou" },
    { label: "Savings", value: `${moneyCompact(total)} across ${household.accounts.length} account${household.accounts.length === 1 ? "" : "s"}`, step: "accounts" },
    {
      label: "Plan to age",
      value: `${settings.endAge}${settings.survivorModel && hasSpouse ? ` · survivor from ${settings.firstDeathAge}` : ""}`,
      step: "longevity",
    },
  ];
  const wages = wageForYear(household.self, household, year) + (hasSpouse ? wageForYear(household.spouse, household, year) : 0);
  if (wages > 0) rows.push({ label: "Work income", value: `${moneyCompact(wages)} in ${year}`, step: "work" });
  const hasSS = household.self.socialSecurityAnnual > 0 || (hasSpouse && household.spouse.socialSecurityAnnual > 0);
  rows.push({
    label: "Social Security",
    value: hasSS
      ? `claim at ${household.self.ssClaimAge}${hasSpouse && household.spouse.socialSecurityAnnual > 0 ? ` / ${household.spouse.ssClaimAge}` : ""}`
      : "none entered",
    step: "ssclaim",
  });
  const streams = otherIncomeForYear(household.otherIncome, year).total;
  const invest =
    (household.brokerageDividendsAnnual ?? 0) +
    (household.ordinaryDividendsAnnual ?? 0) +
    (household.taxableInterestAnnual ?? 0) +
    (household.taxExemptInterestAnnual ?? 0);
  const other = [
    (household.pensionAnnual ?? 0) > 0 ? `pension ${moneyCompact(household.pensionAnnual)}/yr` : "",
    streams > 0 ? `other ${moneyCompact(streams)}/yr` : "",
    invest > 0 ? `investments ${moneyCompact(invest)}/yr` : "",
  ].filter(Boolean);
  rows.push({ label: "Other income", value: other.length ? other.join(" · ") : "none", step: "otherincome" });
  rows.push({ label: "Goal", value: GOAL_META[settings.goal].short, step: "goal" });
  rows.push({
    label: "Markets",
    value: `${(settings.returnRate * 100).toFixed(1)}% return · ${(settings.inflationRate * 100).toFixed(1)}% inflation`,
    step: "markets",
  });
  rows.push({ label: "Spending", value: `${moneyCompact(household.annualSpending)}/yr · ${growth}`, step: "spend" });
  rows.push({ label: "Roth conversions", value: settings.useConversions ? "on" : "off", step: "rollconfirm" });
  return rows;
}

export function YourAnswers({ rows, title = "Your answers" }: { rows: AnswerRow[]; title?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center justify-between bg-foreground/[0.03] px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">{title}</span>
        <span className="text-[11px] text-foreground/40">tap any to change</span>
      </div>
      {rows.map((r) => (
        <Link
          key={r.label}
          href={adjustHref(r.step)}
          className="press flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3 hover:bg-foreground/[0.02]"
        >
          <span className="shrink-0 text-[13px] text-foreground/55">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-foreground">{r.value}</span>
            <span aria-hidden className="text-primary/70">›</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
