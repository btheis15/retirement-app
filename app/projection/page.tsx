"use client";

import { useEffect, useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Stat, Pill, Disclaimer, Callout, Explainer, Info } from "@/components/ui";
import { StackedArea, Bars, CompareBars, AnimatedNumber } from "@/components/charts";
import { projectLifetime } from "@/lib/projection";
import { detectMilestones } from "@/lib/milestones";
import { STRATEGY_META } from "@/lib/optimizer";
import { Household, sumBuckets } from "@/lib/accounts";
import { returnModel } from "@/lib/returns";
import { ReturnMethodInfo } from "@/components/ReturnMethodInfo";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";

// Return scenarios are derived from the household's holdings (see lib/returns).

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
 *  - `nominal`: ending estate still ≥ today's dollar balance (never loses a
 *     raw dollar, though inflation erodes it).
 * Ending estate falls monotonically as spending rises, so we bisect.
 */
function maxSustainableSpend(household: Household, base: SpendBase, startTotal: number) {
  if (startTotal <= 0) return { real: 0, nominal: 0, lastsMax: 0, years: 0, realPossible: false };
  const run = (s: number) => projectLifetime({ ...household, annualSpending: s }, base);
  const zero = run(0);
  const years = zero.yearsModeled;
  const cap = Math.max(startTotal, 50_000);
  const realGoal = startTotal * Math.pow(1 + base.inflationRate, years);
  // Highest spend whose ending estate still clears `goal`.
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
  // Highest spend that doesn't run short before the horizon ends.
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

export default function ProjectionPage() {
  const { ready, household, settings, updateSettings, updateHousehold } = useStore();

  const result = useMemo(() => {
    const base = {
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
    };
    const chosen = projectLifetime(household, { ...base, strategy: settings.strategy });
    const smart = projectLifetime(household, { ...base, strategy: "smart" });
    const conventional = projectLifetime(household, { ...base, strategy: "conventional" });
    const milestones = detectMilestones(household, chosen);
    return { chosen, smart, conventional, milestones };
  }, [household, settings]);

  // Sustainable spending is independent of the current spend target, so it is
  // memoized on everything BUT annualSpending — dragging the slider won't
  // re-run this heavier search.
  const startTotal = sumBuckets(household.accounts).total;
  const sustain = useMemo(
    () =>
      maxSustainableSpend(
        household,
        {
          strategy: settings.strategy,
          bracketTarget: settings.bracketTarget,
          returnRate: settings.returnRate,
          inflationRate: settings.inflationRate,
          endAge: settings.endAge,
        },
        startTotal,
      ),
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

  // Return scenarios derived from the actual holdings.
  const rm = useMemo(() => returnModel(household.accounts), [JSON.stringify(household.accounts)]);
  const scenarios = useMemo(
    () => [
      { id: "cons", label: "Conservative", rate: rm.conservative },
      { id: "mod", label: "Moderate", rate: rm.expected },
      { id: "opt", label: "Optimistic", rate: rm.optimistic },
    ],
    [rm],
  );

  // If the saved return doesn't match any holdings-based card (e.g. a stale
  // default), snap to the expected (Moderate) rate for this portfolio.
  useEffect(() => {
    if (!ready) return;
    const matches = scenarios.some((s) => Math.abs(s.rate - settings.returnRate) < 0.0025);
    if (!matches) updateSettings({ returnRate: rm.expected });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rm.expected, rm.conservative, rm.optimistic]);

  if (!ready) return <div className="h-screen" />;

  const { chosen, smart, conventional, milestones } = result;
  const rows = chosen.rows;

  // Stacked-area series (sample is fine — rows are annual).
  const areaRows = rows.map((r) => ({ x: r.year }));
  const series = [
    { key: "pretax", color: HEX.deferred, values: rows.map((r) => r.startBalances.pretax) },
    { key: "taxable", color: HEX.taxable, values: rows.map((r) => r.startBalances.taxable) },
    { key: "roth", color: HEX.roth, values: rows.map((r) => r.startBalances.roth) },
  ];

  // RMD bars — sample down to ~10 columns.
  const step = Math.max(1, Math.round(rows.length / 10));
  const rmdBars = rows.filter((_, i) => i % step === 0).map((r) => ({ label: `'${String(r.year).slice(2)}`, value: r.rmd }));

  const savings = conventional.lifetimeTax - smart.lifetimeTax;
  const estateGain = smart.endingEstateAfterTax - conventional.endingEstateAfterTax;

  // Spending-power helpers.
  const returnLabel = scenarios.find((s) => Math.abs(settings.returnRate - s.rate) < 0.0025)?.label ?? "custom";
  const endsRicher = chosen.endingEstate > startTotal * 1.001;
  const current = household.annualSpending;
  const sustainMessage =
    current <= sustain.real
      ? `You're spending ${money(current)}/yr — about ${money(Math.max(0, sustain.real - current))} under the inflation-preserving level. You have real room to spend (or give) more, and your buying power would still be intact at age ${settings.endAge}.`
      : current <= sustain.nominal
        ? `At ${money(current)}/yr your raw balance holds, but it slowly loses ground to inflation. Easing back toward ${money(sustain.real)}/yr would fully preserve your buying power.`
        : `At ${money(current)}/yr you're drawing down principal — your balance shrinks over time, which may be perfectly fine. To keep your capital self-sustaining, spend up to about ${money(sustain.real)}/yr (inflation-adjusted).`;

  return (
    <div>
      <PageTitle title="Lifetime forecast" subtitle={`Year-by-year through age ${settings.endAge}, with growth & inflation.`} />

      {/* Scenario controls — derived from holdings */}
      <div className="flex gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => updateSettings({ returnRate: s.rate })}
            className={`press flex-1 rounded-xl border py-2 text-center ${
              Math.abs(settings.returnRate - s.rate) < 0.0025
                ? "border-primary bg-primary/10 text-primary"
                : "border-border"
            }`}
          >
            <div className="text-[12px] font-semibold">{s.label}</div>
            <div className="text-[11px] text-foreground/55">{percent(s.rate, 1)}/yr</div>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-foreground/55">
        Based on your holdings ({percent(rm.equityPct, 0)} stocks · {percent(rm.bondPct, 0)} bonds · {percent(rm.cashPct, 0)} cash).
        Stocks have averaged ~10%/yr long-term, so a stock-heavy mix sits high; these scenarios bracket your blend.
        {rm.basis !== "holdings" && " (Accounts without itemized holdings use an assumed mix — add holdings for precision.)"}
      </p>
      <ReturnMethodInfo rm={rm} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-foreground/60">Inflation</span>
          <select
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm"
            value={settings.inflationRate}
            onChange={(e) => updateSettings({ inflationRate: Number(e.target.value) })}
          >
            {[0.02, 0.025, 0.03, 0.035].map((v) => (
              <option key={v} value={v}>{percent(v, 1)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-foreground/60">Plan to age</span>
          <select
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm"
            value={settings.endAge}
            onChange={(e) => updateSettings({ endAge: Number(e.target.value) })}
          >
            {[85, 90, 95, 100].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Headline */}
      <SectionTitle hint={STRATEGY_META[settings.strategy].label}>If you follow this plan</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-y-4">
          <Stat label="Lifetime federal tax" tone="tax" value={<AnimatedNumber value={chosen.lifetimeTax} format={moneyCompact} />} />
          <Stat
            label={`After-tax estate at ${settings.endAge}`}
            tone="gain"
            value={<AnimatedNumber value={chosen.endingEstateAfterTax} format={moneyCompact} />}
            sub={`${moneyCompact(chosen.endingEstate)} before deferred tax`}
          />
        </div>
        {chosen.depleted && (
          <div className="mt-3">
            <Pill tone="tax">⚠️ Assets run short before age {settings.endAge}</Pill>
          </div>
        )}
      </Card>

      {/* ---------- Spending power ---------- */}
      <SectionTitle>Could you spend more?</SectionTitle>
      <Explainer>
        Drag your spending and the whole forecast reacts. If you tend to under-spend, this shows the real room
        you have at a {returnLabel.toLowerCase()} {percent(settings.returnRate, 1)} return.
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

      {/* ---------- Self-sustaining spending ---------- */}
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
              the portfolio can&apos;t fully keep pace with rising costs even at $0 spending. Try the Optimistic
              scenario above — or know that drawing down some capital is expected here.
            </Callout>
          )}
          <Info q="What does &quot;self-sustaining&quot; mean here?">
            We re-run the full year-by-year forecast at many spending levels and find the highest one where your
            money lasts <em>and</em> your ending balance still matches today&apos;s — either inflation-adjusted
            (keeps your buying power) or in raw dollars. At or below that level, investment growth covers your
            withdrawals, so the assets essentially fund themselves. It assumes the steady{" "}
            {percent(settings.returnRate, 1)} return shown; real markets bounce around, so leave a cushion.
          </Info>
        </>
      )}

      {/* Balances over time */}
      <SectionTitle>Account balances over time</SectionTitle>
      <Card>
        <StackedArea rows={areaRows} series={series} yLabel={(n) => moneyCompact(n)} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <Key color={HEX.deferred} label="Pre-tax" />
          <Key color={HEX.taxable} label="Taxable" />
          <Key color={HEX.roth} label="Roth" />
        </div>
        <p className="mt-2 text-[12px] text-foreground/55">
          Watch the pre-tax (amber) band: the smart plan shrinks it early so forced RMDs stay small,
          while Roth (violet) is preserved for last.
        </p>
      </Card>

      {/* RMD ramp */}
      <SectionTitle>Required minimum distributions</SectionTitle>
      <Card>
        {rmdBars.some((b) => b.value > 0) ? (
          <Bars data={rmdBars} color={HEX.deferred} />
        ) : (
          <p className="text-sm text-foreground/70">
            No RMDs within this horizon — they start at age 73–75 depending on birth year. The years
            before then are your cheapest window to draw down pre-tax money voluntarily.
          </p>
        )}
      </Card>

      {/* Strategy comparison */}
      <SectionTitle>Smart vs. conventional</SectionTitle>
      <Card>
        <p className="mb-3 text-[13px] text-foreground/70">Estimated lifetime federal tax — same spending & assumptions:</p>
        <CompareBars
          items={[
            { label: "Smart (bracket-fill)", value: smart.lifetimeTax, color: HEX.gain },
            { label: "Conventional order", value: conventional.lifetimeTax, color: HEX.tax },
          ]}
          format={(n) => money(n)}
        />
        <p className="mb-2 mt-5 text-[13px] text-foreground/70">After-tax estate left at age {settings.endAge}:</p>
        <CompareBars
          items={[
            { label: "Smart (bracket-fill)", value: smart.endingEstateAfterTax, color: HEX.gain },
            { label: "Conventional order", value: conventional.endingEstateAfterTax, color: HEX.taxable },
          ]}
          format={(n) => money(n)}
        />
        {(savings > 1000 || estateGain > 1000) && (
          <p className="mt-3 rounded-xl bg-gain/10 p-3 text-[13px] text-gain">
            {savings > 1000 && (
              <>
                The smart plan pays about <strong>{money(savings)}</strong> less in lifetime federal tax
                {estateGain > 1000 ? " " : "."}
              </>
            )}
            {estateGain > 1000 && (
              <>
                and leaves about <strong>{money(estateGain)}</strong> more after-tax wealth to your
                heirs.
              </>
            )}
          </p>
        )}
        {savings <= 1000 && estateGain <= 1000 && (
          <p className="mt-3 rounded-xl bg-foreground/5 p-3 text-[13px] text-foreground/65">
            At these assumptions the two strategies are close — the smart plan front-loads tax to shrink
            future RMDs, while the conventional order keeps more invested but faces larger taxable RMDs
            later. Try a higher spending level or return to see the gap widen.
          </p>
        )}
      </Card>

      {/* Decisions timeline */}
      <SectionTitle hint={`${milestones.length} events`}>Key decisions & milestones</SectionTitle>
      <div className="space-y-2">
        {milestones.map((m, i) => (
          <Card as="div" key={i} className={`border-l-4 ${toneBorder(m.tone)}`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <span>{m.icon}</span> {m.title}
              </span>
              <span className="tabular text-[12px] text-foreground/55">{m.year} · age {m.age}</span>
            </div>
            <p className="mt-1 text-[13px] text-foreground/70">{m.detail}</p>
          </Card>
        ))}
      </div>

      {/* Year table */}
      <SectionTitle>Year by year</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-right text-[12px]">
          <thead className="text-foreground/50">
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-left">Yr / age</th>
              <th className="px-2 py-2">Pre-tax</th>
              <th className="px-2 py-2">Broker</th>
              <th className="px-2 py-2">Roth</th>
              <th className="px-2 py-2">Tax</th>
              <th className="px-2 py-2">Assets</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.year} className="border-b border-border/50">
                <td className="px-2 py-1.5 text-left text-foreground/60">
                  {r.year} · {r.selfAge}
                </td>
                <td className="px-2 py-1.5 text-deferred">{r.fromPretax > 0 ? moneyCompact(r.fromPretax) : "—"}</td>
                <td className="px-2 py-1.5 text-taxable">{r.fromTaxable > 0 ? moneyCompact(r.fromTaxable) : "—"}</td>
                <td className="px-2 py-1.5 text-roth">{r.fromRoth > 0 ? moneyCompact(r.fromRoth) : "—"}</td>
                <td className="px-2 py-1.5 text-tax">{moneyCompact(r.tax)}</td>
                <td className="px-2 py-1.5">{moneyCompact(r.endTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-foreground/60">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function toneBorder(tone: "info" | "warn" | "good"): string {
  return tone === "warn" ? "border-l-tax" : tone === "good" ? "border-l-gain" : "border-l-ss";
}

/** A color-zoned scale under the spending slider so the ranges are obvious
 *  without trial-and-error: grow / hold / draw-down / run-short, with the
 *  dollar boundaries labeled. */
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
  // Keep the boundaries monotonic for clean zones.
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
        {/* current spend marker */}
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
