"use client";

import { useEffect, useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, SectionTitle, Explainer, Info, Pill, Callout } from "@/components/ui";
import { projectLifetime } from "@/lib/projection";
import { Household, sumBuckets } from "@/lib/accounts";
import { returnModel } from "@/lib/returns";
import { money, moneyCompact, percent } from "@/lib/format";

const SPEND_MAX = 500_000;
const SPEND_STEP = 5_000;

interface SpendBase {
  strategy: "smart" | "conventional" | "proportional";
  bracketTarget: 0.12 | 0.22 | 0.24 | 0.32;
  returnRate: number;
  inflationRate: number;
  endAge: number;
}

/**
 * Highest annual after-tax spend the portfolio can sustain over the horizon:
 *  - `real`: ending estate still ≥ today's value grown by inflation (keeps
 *     buying power — the recommended "self-sustaining" ceiling).
 *  - `nominal`: ending estate still ≥ today's dollar balance.
 *  - `lastsMax`: highest spend that doesn't run short before the horizon ends.
 */
function maxSustainableSpend(household: Household, base: SpendBase, startTotal: number) {
  if (startTotal <= 0) return { real: 0, nominal: 0, lastsMax: 0, years: 0, realPossible: false };
  const run = (s: number) => projectLifetime({ ...household, annualSpending: s }, base);
  const zero = run(0);
  const years = zero.yearsModeled;
  const cap = Math.max(startTotal, 50_000);
  const realGoal = startTotal * Math.pow(1 + base.inflationRate, years);
  const findByEstate = (goal: number) => {
    if (zero.endingEstate < goal) return 0;
    let lo = 0;
    let hi = cap;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (run(mid).endingEstate >= goal) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const findLasts = () => {
    if (zero.depleted) return 0;
    if (!run(cap).depleted) return cap;
    let lo = 0;
    let hi = cap;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (!run(mid).depleted) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  return {
    real: findByEstate(realGoal),
    nominal: findByEstate(startTotal),
    lastsMax: findLasts(),
    years,
    realPossible: zero.endingEstate >= realGoal,
  };
}

/** A color-zoned scale under the slider: grow / hold / draw-down / run-short,
 *  with the dollar boundaries labeled. */
function SpendScale({
  max,
  current,
  real,
  nominal,
  lasts,
  endAge,
}: {
  max: number;
  current: number;
  real: number;
  nominal: number;
  lasts: number;
  endAge: number;
}) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const r = real;
  const n = Math.max(nominal, real);
  const l = Math.max(lasts, n);
  const zones = [
    { from: 0, to: pct(r), cls: "bg-gain/70" },
    { from: pct(r), to: pct(n), cls: "bg-ss/55" },
    { from: pct(n), to: pct(l), cls: "bg-deferred/55" },
    { from: pct(l), to: 100, cls: "bg-tax/55" },
  ];
  const rows = [
    { color: "bg-gain/70", label: `up to ${moneyCompact(r)}/yr`, note: "grows — keeps up with inflation", show: r > 0 },
    { color: "bg-ss/55", label: `${moneyCompact(r)} – ${moneyCompact(n)}/yr`, note: "holds its value (loses a little to inflation)", show: n > r },
    { color: "bg-deferred/55", label: `${moneyCompact(n)} – ${moneyCompact(l)}/yr`, note: `draws down, but lasts to age ${endAge}`, show: l > n },
    { color: "bg-tax/55", label: `above ${moneyCompact(l)}/yr`, note: `runs short before age ${endAge}`, show: l < max },
  ].filter((x) => x.show);
  return (
    <div className="mt-3">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
        {zones.map((z, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${z.cls}`}
            style={{ left: `${z.from}%`, width: `${Math.max(0, z.to - z.from)}%` }}
          />
        ))}
        <div className="absolute -top-1 h-[18px] w-[2px] bg-foreground" style={{ left: `calc(${pct(current)}% - 1px)` }} />
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${row.color}`} />
            <span className="text-foreground/75">
              <strong className="tabular">{row.label}</strong> — {row.note}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-foreground/45">▏The line marks your current {moneyCompact(current)}/yr.</p>
    </div>
  );
}

/**
 * The interactive "Could you spend more?" widget — a spending slider with a
 * labeled, color-zoned scale, the resulting ending balance, and the
 * self-sustaining spending level. Self-contained; drop it on any page.
 */
export function SpendingPowerCard() {
  const { ready, household, settings, updateSettings, updateHousehold } = useStore();

  const rm = useMemo(() => returnModel(household.accounts), [JSON.stringify(household.accounts)]);

  // Keep the return assumption holdings-appropriate even if the user hasn't
  // visited the Forecast/Compare toggles yet.
  useEffect(() => {
    if (!ready) return;
    const cards = [rm.conservative, rm.expected, rm.optimistic];
    if (!cards.some((c) => Math.abs(c - settings.returnRate) < 0.0025)) updateSettings({ returnRate: rm.expected });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rm.expected, rm.conservative, rm.optimistic]);

  const base: SpendBase = {
    strategy: settings.strategy,
    bracketTarget: settings.bracketTarget,
    returnRate: settings.returnRate,
    inflationRate: settings.inflationRate,
    endAge: settings.endAge,
  };

  const chosen = useMemo(() => projectLifetime(household, base), [household, settings]);

  const startTotal = sumBuckets(household.accounts).total;
  const sustain = useMemo(
    () => maxSustainableSpend(household, base, startTotal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(household.accounts),
      household.self,
      household.spouse,
      household.pensionAnnual,
      household.brokerageDividendsAnnual,
      settings.strategy,
      settings.bracketTarget,
      settings.returnRate,
      settings.inflationRate,
      settings.endAge,
      startTotal,
    ],
  );

  if (!ready) return null;

  const returnLabel =
    Math.abs(settings.returnRate - rm.conservative) < 0.0025
      ? "conservative"
      : Math.abs(settings.returnRate - rm.optimistic) < 0.0025
        ? "optimistic"
        : "moderate";
  const endsRicher = chosen.endingEstate > startTotal * 1.001;
  const current = household.annualSpending;
  const sustainMessage =
    current <= sustain.real
      ? `You're spending ${money(current)}/yr — about ${money(Math.max(0, sustain.real - current))} under the inflation-preserving level. You have real room to spend (or give) more, and your buying power would still be intact at age ${settings.endAge}.`
      : current <= sustain.nominal
        ? `At ${money(current)}/yr your raw balance holds, but it slowly loses ground to inflation. Easing back toward ${money(sustain.real)}/yr would fully preserve your buying power.`
        : `At ${money(current)}/yr you're drawing down principal — your balance shrinks over time, which may be perfectly fine. To keep your capital self-sustaining, spend up to about ${money(sustain.real)}/yr (inflation-adjusted).`;

  return (
    <>
      <SectionTitle>Could you spend more?</SectionTitle>
      <Explainer>
        Drag your spending and the whole forecast reacts. If you tend to under-spend, this shows the real room
        you have at a {returnLabel} {percent(settings.returnRate, 1)} return.
      </Explainer>
      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-foreground/60">Yearly spending (after tax)</span>
          <span className="tabular text-2xl font-bold text-primary">{money(household.annualSpending)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={SPEND_MAX}
          step={SPEND_STEP}
          value={Math.min(SPEND_MAX, household.annualSpending)}
          onChange={(e) => updateHousehold({ annualSpending: Number(e.target.value) })}
          className="mt-3 w-full accent-primary"
          aria-label="Yearly spending"
        />
        <div className="mt-1 flex justify-between text-[11px] text-foreground/45">
          <span>{moneyCompact(0)}</span>
          <span>{moneyCompact(SPEND_MAX)}+</span>
        </div>
        {startTotal > 0 && (
          <SpendScale
            max={SPEND_MAX}
            current={household.annualSpending}
            real={sustain.real}
            nominal={sustain.nominal}
            lasts={sustain.lastsMax}
            endAge={settings.endAge}
          />
        )}
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[13px]">
          <span className="text-foreground/65">At age {settings.endAge} you&apos;d have</span>
          <span className="tabular font-semibold text-gain">{money(chosen.endingEstateAfterTax)}</span>
        </div>
        <div className="mt-2">
          {chosen.depleted ? (
            <Pill tone="tax">⚠️ Runs short before age {settings.endAge}</Pill>
          ) : endsRicher ? (
            <Pill tone="gain">📈 Grows — you end with more than you have today</Pill>
          ) : (
            <Pill tone="ss">✓ Lasts the whole horizon</Pill>
          )}
        </div>
      </Card>

      {startTotal > 0 && (
        <>
          <SectionTitle>Your self-sustaining spending level</SectionTitle>
          <Explainer>
            The most you could take out each year and still preserve your capital — the level where growth funds
            your spending, so you basically never lose ground.
          </Explainer>
          {sustain.realPossible ? (
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gain/30 bg-gain/5 p-3">
                  <div className="text-[11px] text-foreground/55">Keep pace with inflation</div>
                  <div className="tabular text-lg font-bold text-gain">
                    {moneyCompact(sustain.real)}
                    <span className="text-[11px] font-medium text-foreground/50">/yr</span>
                  </div>
                  <div className="text-[10px] text-foreground/45">buying power intact at age {settings.endAge}</div>
                </div>
                <div className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="text-[11px] text-foreground/55">Never lose a dollar</div>
                  <div className="tabular text-lg font-bold text-taxable">
                    {moneyCompact(sustain.nominal)}
                    <span className="text-[11px] font-medium text-foreground/50">/yr</span>
                  </div>
                  <div className="text-[10px] text-foreground/45">balance never dips below today</div>
                </div>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-foreground/75">{sustainMessage}</p>
            </Card>
          ) : (
            <Callout tone="warn" icon="📉" title="Not self-sustaining at this return">
              At a {percent(settings.returnRate, 1)} return against {percent(settings.inflationRate, 1)} inflation,
              the portfolio can&apos;t fully keep pace with rising costs even at $0 spending. Try a more optimistic
              return — or know that drawing down some capital is expected here.
            </Callout>
          )}
          <Info q="What does &quot;self-sustaining&quot; mean here?">
            We re-run the full year-by-year forecast at many spending levels and find the highest one where your
            money lasts <em>and</em> your ending balance still matches today&apos;s — either inflation-adjusted
            (keeps your buying power) or in raw dollars. At or below that level, investment growth covers your
            withdrawals, so the assets essentially fund themselves. It assumes the steady {percent(settings.returnRate, 1)}{" "}
            return shown; real markets bounce around, so leave a cushion.
          </Info>
        </>
      )}
    </>
  );
}
