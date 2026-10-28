"use client";

import { useEffect, useState } from "react";
import { Info, AdjustLink } from "@/components/ui";
import { activeAssumptions } from "@/lib/planContext";
import { computeMonteCarlo } from "@/lib/mcClient";
import { returnModel } from "@/lib/returns";
import { money, moneyCompact } from "@/lib/format";
import type { Household } from "@/lib/accounts";
import type { PlannerSettings } from "@/lib/defaults";
import type { MonteCarloResult } from "@/lib/monteCarlo";
import { findSafeSpend, ladderAmounts, LADDER_FACTORS, ON_TRACK, SafeSpendResult } from "@/components/spendingOdds";

/** 10-dot icon array: filled = lasts, hollow = doesn't. Shape + fill, not color alone. */
function DotArray({ of10 }: { of10: number }) {
  return (
    <span role="img" aria-label={`${of10} of 10`} className="inline-flex gap-1">
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`inline-block h-3 w-3 rounded-full border-2 border-primary ${i < of10 ? "bg-primary" : "bg-transparent"}`}
        />
      ))}
    </span>
  );
}

const tone = (pct: number) => (pct >= ON_TRACK ? "On track" : pct >= 0.7 ? "Worth watching" : "Needs a look");

/** "How much you can safely spend" — shown right under the plan summary, not collapsed.
 *  Safe = highest spending whose paired Monte-Carlo odds are at least 85% (PlanHero's
 *  "On track" line). Read-only: spending is edited in the walkthrough, never here. */
export function SpendingOddsCard({
  household,
  settings,
  confidence,
}: {
  household: Household;
  settings: PlannerSettings;
  confidence: MonteCarloResult | null;
}) {
  const base = household.annualSpending;
  const couple = !!household.spouse && household.spouse.birthYear > 1900;
  const who = couple ? "both of you" : "you";
  const [res, setRes] = useState<SafeSpendResult | null>(null);
  const [atPlan, setAtPlan] = useState<MonteCarloResult | null>(null);
  const [failed, setFailed] = useState(false);
  const ready = confidence != null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setRes(null);
    setFailed(false);
    // Same function, inputs, run count and DEFAULT fixed seed as the Plan tab's confidence
    // number, so every level sees the same market paths. Only spending varies.
    const assumptions = activeAssumptions(settings);
    const model = returnModel(household.accounts);
    (async () => {
      let current: MonteCarloResult | null = null;
      const out = await findSafeSpend(base, async (yearly) => {
        const r = await computeMonteCarlo({
          kind: "mc",
          household: { ...household, annualSpending: yearly },
          assumptions,
          model,
          runs: 1000,
        });
        if (yearly === base) current = r;
        return r.successPct;
      });
      if (cancelled) return;
      setAtPlan(current);
      setRes(out);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, household, settings, base]);

  if (failed) return null;
  if (!res) {
    return (
      <section className="mt-3 rounded-2xl border border-border bg-card px-4 py-3 text-[15px] text-foreground/75" aria-live="polite">
        Working out your safe spending…
      </section>
    );
  }

  const { safe, atLeast } = res;
  const pctAt = new Map(res.levels.map((l) => [l.yearly, l.pct]));
  const gap = safe != null ? safe - base : 0;
  const startTotal = household.accounts.reduce((s, a) => s + a.balance, 0);
  const endReal = atPlan?.endingWealthReal.p50;
  const upTo = atLeast ? "at least" : "up to";

  return (
    <section className="mt-3 rounded-2xl border border-primary/30 bg-primary/[0.05] px-4 py-3.5 text-foreground/85">
      {safe != null ? (
        <>
          <h2 className="text-[19px] font-semibold leading-snug text-foreground">
            You can safely spend {upTo} {money(safe)} a year ({money(safe / 12)} a month), {who}
          </h2>
          <p className="mt-1 text-[15px] leading-snug">
            &ldquo;Safely&rdquo; means your money still lasts to age {settings.endAge} in about 9 of 10 market futures
            (at least 85%, our &ldquo;on track&rdquo; line).
          </p>
        </>
      ) : (
        <h2 className="text-[19px] font-semibold leading-snug text-foreground">
          Even the lower spending levels we tried are below our &ldquo;on track&rdquo; line
        </h2>
      )}

      {safe != null && gap >= 3000 && (
        <p className="mt-2.5 text-[16px] leading-snug">
          <strong>You could give yourselves a raise of about {money(Math.round(gap / 12 / 10) * 10)} a month</strong> and
          still be On track.
          {endReal != null && endReal > 0 && (
            <>
              {" "}
              At today&apos;s spending, your savings are projected to {endReal > startTotal ? "grow to" : "be about"}{" "}
              {moneyCompact(endReal)} by age {settings.endAge} (today&apos;s dollars)
              {endReal > startTotal ? `, more than the ${moneyCompact(startTotal)} you have now` : ""}. That is the typical
              result; it is a projection, not a promise.
            </>
          )}
        </p>
      )}
      {safe != null && gap < 3000 && gap > -3000 && (
        <p className="mt-2.5 text-[15px] leading-snug">Your plan already spends close to the safe amount.</p>
      )}
      {safe != null && gap <= -3000 && (
        <p className="mt-2.5 text-[15px] leading-snug">
          Your plan spends more than this. That is not a failure, but expect to trim in bad market years.
        </p>
      )}

      <Info q="See the odds at other spending levels" className="mt-3">
        <div className="text-[15px] leading-snug text-foreground/85">
          <p>Spending for {who} each year, in today&apos;s dollars. Same markets for every row.</p>
          <ul className="mt-3 space-y-2.5">
            {ladderAmounts(base).map((yearly, i) => {
              const pct = pctAt.get(yearly) ?? 0;
              const of10 = Math.round(pct * 10);
              const mine = LADDER_FACTORS[i] === 1;
              return (
                <li
                  key={yearly}
                  className={`rounded-xl border px-3 py-2.5 ${mine ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-card"}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">
                      {money(yearly / 12)}/month · {money(yearly)}/year{" "}
                      <span className="font-normal text-foreground/65">({who})</span>
                    </span>
                    {mine && <span className="text-[13px] font-semibold text-primary">Your plan</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <DotArray of10={of10} />
                    <span>
                      Lasts to age {settings.endAge} in about <strong>{of10} of 10</strong> market futures
                      <span className="text-foreground/65"> — {tone(pct)}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[13px] text-foreground/70">
            These odds assume you never change your spending. Real retirees trim spending in bad years, so a lower number
            means &ldquo;you&apos;d likely need to adjust,&rdquo; not &ldquo;you&apos;d go broke.&rdquo; Filled dots show
            how many of 10 market futures your money lasts; the odds are an estimate, not a promise.
          </p>
        </div>
      </Info>
      <div className="mt-2">
        <AdjustLink step="spend" label="Change your spending" className="min-h-[44px] text-[13px]" />
      </div>
    </section>
  );
}
