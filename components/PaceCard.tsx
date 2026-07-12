"use client";

/**
 * PaceCard — "where should I be right now?"
 *
 * The walkthrough decides the YEAR's plan; this card translates it into today's
 * terms so the app is worth opening any day: the steady monthly pace for each
 * money move, roughly how much should already be done by this point in the
 * year, and the real calendar deadlines coming up. Pure display — every number
 * comes from the committed plan via lib/pace.
 */

import { useMemo } from "react";
import { Card, DesktopOnly, Info } from "@/components/ui";
import { useStore } from "@/components/HouseholdProvider";
import { YearPace } from "@/lib/pace";
import { money, moneyCompact } from "@/lib/format";

const TONE_BAR: Record<string, string> = {
  taxable: "bg-taxable",
  deferred: "bg-deferred",
  roth: "bg-roth",
  tax: "bg-tax",
  ss: "bg-ss",
};

export function PaceCard({ pace, incomeNote }: { pace: YearPace; incomeNote?: string }) {
  const { household } = useStore();
  const isIllinois = (household.state ?? "IL") === "IL";
  const pct = Math.round(pace.yearFraction * 100);
  const monthsLeft = 12 - pace.monthsDone;
  const nextDeadlines = useMemo(() => pace.deadlines.slice(0, 3), [pace.deadlines]);

  return (
    <Card>
      {/* Header: where in the year we are */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[15px] font-bold">
          Your pace — <span className="text-primary">{pace.monthName} {pace.year}</span>
        </div>
        <div className="text-[11px] text-foreground/45">{pct}% through the year</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/8">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>

      {/* The monthly rhythm */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-background/60 p-2.5">
          <div className="text-[11px] text-foreground/55">You spend about</div>
          <div className="tabular text-lg font-bold">{money(Math.round(pace.spendingMonthly))}<span className="text-[12px] font-medium text-foreground/45">/mo</span></div>
        </div>
        <div className="rounded-xl border border-border bg-background/60 p-2.5">
          <div className="text-[11px] text-foreground/55">Checks arriving</div>
          {pace.guaranteedMonthly > 0.5 ? (
            <div className="tabular text-lg font-bold text-ss">
              {money(Math.round(pace.guaranteedMonthly))}
              <span className="text-[12px] font-medium text-foreground/45">/mo</span>
            </div>
          ) : (
            <>
              <div className="text-lg font-bold text-foreground/40">None yet</div>
              {incomeNote && <div className="text-[10px] leading-snug text-foreground/50">{incomeNote}</div>}
            </>
          )}
        </div>
      </div>

      {/* Pace lines: annual plan → monthly pace → where you should be by now */}
      {pace.items.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {pace.items.map((it) => {
            const donePct = it.annual > 0 ? Math.round((it.byNow / it.annual) * 100) : 0;
            return (
              <div key={it.label}>
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-medium">{it.label}</span>
                  <span className="tabular text-foreground/60">
                    ≈ <strong className="text-foreground">{moneyCompact(it.monthly)}</strong>/mo · {moneyCompact(it.annual)}/yr
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/8">
                    <div className={`h-full rounded-full ${TONE_BAR[it.tone]}`} style={{ width: `${donePct}%`, opacity: 0.75 }} />
                  </div>
                  <span className="tabular shrink-0 text-[11px] text-foreground/50">
                    by now ≈ {moneyCompact(it.byNow)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Roth rollover: a deadline task, not a monthly chore */}
      {pace.conversion > 0.5 && (
        <p className="mt-3 rounded-xl bg-roth/5 px-3 py-2 text-[12px] leading-snug text-foreground/70">
          🔁 <strong>Roth conversion this year: {money(Math.round(pace.conversion))}.</strong> It counts for {pace.year} as
          long as it&apos;s done by <strong>December 31</strong> — one transfer or a few chunks over the remaining{" "}
          {monthsLeft} month{monthsLeft === 1 ? "" : "s"} both work.
        </p>
      )}

      {/* Real dates coming up */}
      {nextDeadlines.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Coming up</div>
          <ul className="mt-1.5 space-y-1.5">
            {nextDeadlines.map((d) => (
              <li key={`${d.label}-${d.when}`} className="flex items-start gap-2.5 text-[12px]">
                <span className="tabular mt-px shrink-0 rounded-md bg-primary/8 px-1.5 py-0.5 font-semibold text-primary">
                  {d.when}
                </span>
                <span className="min-w-0 leading-snug">
                  <strong>{d.label}</strong>
                  {d.inDays <= 45 && <span className="text-foreground/50"> · in {d.inDays} day{d.inDays === 1 ? "" : "s"}</span>}
                  <DesktopOnly>
                    <span className="block text-foreground/55">{d.detail}</span>
                  </DesktopOnly>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* How to actually PAY the tax — the one mechanic a new retiree has never
          done (no employer withholding anymore). Deliberately NOT DesktopOnly:
          it changes what the customer does, so it must exist on the phone. */}
      {pace.estTaxQuarterly > 0 && (
        <>
          <p className="mt-2.5 text-[12px] leading-snug text-foreground/55">
            Taxes: either have your custodian <strong>withhold</strong> from each withdrawal, or pay quarterly estimates
            of about <strong>{money(Math.round(pace.estTaxQuarterly))}</strong> (IRS 1040-ES: Apr 15, Jun 15, Sep 15,
            Jan 15){isIllinois ? (
              <>
                , and Illinois expects its own quarterly estimates (Form IL-1040-ES) if you&apos;ll owe it more
                than $1,000
              </>
            ) : null}.
          </p>
          <p className="mt-2 text-[12px] leading-snug text-foreground/55">
            No-penalty shortcut: if your withholding + estimates this year total at least 100% of last year&apos;s tax
            bill (110% if your income was over $150k), the IRS charges no underpayment penalty even if you owe more
            in April — especially useful in your first year of retirement or a big conversion year.
          </p>
        </>
      )}

      <Info q="How to read this pace" className="mt-2.5">
        <p>
          These are steady-pace guides, not rules — the plan works the same if you withdraw monthly, quarterly, or in a
          few larger moves. &ldquo;By now&rdquo; is simply the year&apos;s plan spread evenly across the calendar
          ({pct}% of the year is behind you). If you&apos;re a bit ahead or behind, nothing is wrong; it&apos;s the
          December 31 totals that matter for taxes, RMDs, and conversions.
        </p>
      </Info>
    </Card>
  );
}
