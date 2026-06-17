"use client";

import { useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Stat, Pill, Disclaimer, Callout, Explainer, Info, PageSkeleton } from "@/components/ui";
import { StackedArea, Bars, CompareBars, AnimatedNumber, FanChart } from "@/components/charts";
import { projectLifetime } from "@/lib/projection";
import { detectMilestones } from "@/lib/milestones";
import { analyzeConversions } from "@/lib/rothConversion";
import { runMonteCarlo } from "@/lib/monteCarlo";
import { STRATEGY_META } from "@/lib/optimizer";
import { returnModel } from "@/lib/returns";
import { survivorFromSettings } from "@/lib/defaults";
import { ReturnMethodInfo } from "@/components/ReturnMethodInfo";
import { SpendingPowerCard } from "@/components/SpendingPowerCard";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

export default function ProjectionPage() {
  const { ready, household, settings, updateSettings } = useStore();

  const result = useMemo(() => {
    const base = {
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      survivor: survivorFromSettings(settings),
    };
    const chosen = projectLifetime(household, {
      ...base,
      strategy: settings.strategy,
      convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
    });
    const smart = projectLifetime(household, { ...base, strategy: "smart" });
    const conventional = projectLifetime(household, { ...base, strategy: "conventional" });
    const milestones = detectMilestones(household, chosen);
    const conv = analyzeConversions(household, {
      strategy: settings.strategy === "proportional" ? "smart" : settings.strategy,
      bracketTarget: settings.bracketTarget,
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
      convertUntilAge: settings.convertUntilAge,
      mode: settings.convertMode,
      survivor: survivorFromSettings(settings),
    });
    return { chosen, smart, conventional, milestones, conv };
  }, [household, settings]);

  // Monte-Carlo "plan confidence" for the active plan (fixed seed → stable number).
  const mc = useMemo(
    () => {
      const m = returnModel(household.accounts);
      return runMonteCarlo(
        household,
        {
          strategy: settings.strategy,
          bracketTarget: settings.bracketTarget,
          returnRate: settings.returnRate,
          inflationRate: settings.inflationRate,
          endAge: settings.endAge,
          convert: settings.useConversions ? { untilAge: settings.convertUntilAge, mode: settings.convertMode } : null,
          survivor: survivorFromSettings(settings),
        },
        { expected: m.expected, volatility: m.volatility },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household, settings],
  );

  // Return scenarios derived from the actual holdings (the SpendingPowerCard
  // normalizes settings.returnRate to one of these on mount).
  const rm = useMemo(() => returnModel(household.accounts), [JSON.stringify(household.accounts)]);
  const scenarios = useMemo(
    () => [
      { id: "cons", label: "Conservative", rate: rm.conservative },
      { id: "mod", label: "Moderate", rate: rm.expected },
      { id: "opt", label: "Optimistic", rate: rm.optimistic },
    ],
    [rm],
  );

  if (!ready) return <PageSkeleton />;

  const { chosen, smart, conventional, milestones, conv } = result;
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

  // RMD summary: when they begin, the first amount, and the peak.
  const firstRmd = rows.find((r) => r.rmd > 0);
  const peakRmd = rows.reduce((m, r) => Math.max(m, r.rmd), 0);

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
        <div className="grid grid-cols-3 gap-y-4">
          <Stat label="Lifetime tax (fed + IL)" tone="tax" value={<AnimatedNumber value={chosen.lifetimeTax} format={moneyCompact} />} />
          <Stat
            label={`After-tax estate at ${settings.endAge}`}
            tone="gain"
            value={<AnimatedNumber value={chosen.endingEstateAfterTax} format={moneyCompact} />}
            sub={`${moneyCompact(chosen.endingEstate)} before deferred tax`}
          />
          <Stat
            label="Plan confidence"
            tone={mc.successPct >= 0.8 ? "gain" : mc.successPct >= 0.6 ? "default" : "tax"}
            value={`${Math.round(mc.successPct * 100)}%`}
            sub={`money lasts to ${settings.endAge}`}
          />
        </div>
        {chosen.depleted && (
          <div className="mt-3">
            <Pill tone="tax">⚠️ At the flat return, assets run short before age {settings.endAge}</Pill>
          </div>
        )}
      </Card>

      {/* ---------- Monte-Carlo: probability the money lasts ---------- */}
      <SectionTitle hint={`${mc.runs} simulations`}>Will your money last? (market-risk check)</SectionTitle>
      <Explainer>
        The forecast above uses one steady return. Real markets bounce around — here we re-run your plan {mc.runs} times with
        random yearly returns (~{percent(rm.volatility, 0)} volatility for your mix) to see how often it funds your full spending.
      </Explainer>
      <Card>
        <div className="text-center">
          <div className="tabular text-3xl font-bold" style={{ color: mc.successPct >= 0.8 ? HEX.gain : mc.successPct >= 0.6 ? HEX.accent : HEX.tax }}>
            {Math.round(mc.successPct * 100)}%
          </div>
          <div className="text-[13px] text-foreground/65">
            of simulations funded your full spending to age {settings.endAge}
          </div>
        </div>
        <div className="mt-4">
          <FanChart band={mc.band} yLabel={(n) => moneyCompact(n)} />
          <p className="mt-1 text-[11px] text-foreground/45">
            Shaded band = the 10th–90th percentile range of money left each year; line = the median outcome.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniBox label="Unlucky (10th)" value={moneyCompact(mc.endingWealth.p10)} tone="tax" />
          <MiniBox label="Median" value={moneyCompact(mc.endingWealth.p50)} />
          <MiniBox label="Lucky (90th)" value={moneyCompact(mc.endingWealth.p90)} tone="gain" />
        </div>
        <Info q="How should I read this?" sources={[]}>
          Returns are modeled as independent random draws around your portfolio&apos;s long-run average — they capture
          sequence-of-returns risk (a bad early stretch hurts more) but not fat tails or crashes, so treat the percentage as
          a directional confidence check, not a guarantee. A concentrated, single-stock portfolio is riskier than the
          volatility shown. Lowering spending, delaying Social Security, or holding more bonds raises the number.
        </Info>
      </Card>

      {chosen.survivorYear > 0 && (
        <Callout tone="warn" icon="🕊️" title={`Survivor years modeled from ${chosen.survivorYear}`} className="mt-2">
          From {chosen.survivorYear} the forecast assumes one spouse has passed and the survivor files <strong>single</strong>{" "}
          — tax brackets and the standard deduction roughly halve, so the same RMDs are taxed harder (the &quot;widow&apos;s
          penalty&quot;). It&apos;s built into every number here, and it&apos;s a major reason converting to Roth during your
          joint years pays off.
        </Callout>
      )}

      {/* Spending power (shared with Home) */}
      <SpendingPowerCard />

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
      {firstRmd ? (
        <Callout tone="info" icon="📌" title={`RMDs begin in ${firstRmd.year} (age ${firstRmd.selfAge})`}>
          Your first required withdrawal is about <strong>{money(firstRmd.rmd)}</strong>, rising to roughly{" "}
          <strong>{money(peakRmd)}</strong> at the peak as the IRS divisor shrinks. RMDs are taxed as ordinary
          income whether you need the cash or not. <strong>The plan always takes at least the RMD</strong> (it
          comes out first), so you&apos;ll never under-withdraw — the year-by-year table below shows the pre-tax
          column meeting or exceeding it.
        </Callout>
      ) : (
        <Callout tone="good" icon="🌱" title="No RMDs within this horizon">
          Required withdrawals start at age 73–75 (by birth year). The years before then are your cheapest
          window to draw down pre-tax money voluntarily, before it&apos;s forced out and taxed.
        </Callout>
      )}
      <Card>
        {rmdBars.some((b) => b.value > 0) ? (
          <Bars data={rmdBars} color={HEX.deferred} />
        ) : (
          <p className="text-sm text-foreground/70">
            No RMDs within this horizon — they start at age 73–75 depending on birth year.
          </p>
        )}
      </Card>

      <Info q="Why do RMDs keep growing? What's the &quot;IRS divisor&quot;?" sources={[SOURCES.rmd, SOURCES.rmdAge]}>
        <p className="mb-1.5">
          Each year&apos;s RMD = your <strong>prior year-end pre-tax balance ÷ an IRS divisor</strong>. The divisor
          comes from the IRS Uniform Lifetime Table and is roughly how many more years the IRS expects the money
          to last, so it doubles as a built-in spend-down schedule.
        </p>
        <p className="mb-1.5">
          As you age, that divisor <strong>shrinks</strong> — you divide by a smaller number, so you must pull a
          bigger slice each year. At age 75 the divisor is 24.6 (about <strong>4%</strong> of the balance); by 85
          it&apos;s 16.0 (<strong>~6.25%</strong>); by 90 it&apos;s 12.2 (<strong>~8.2%</strong>). And because the
          balance itself keeps growing with investment returns, the dollar amount climbs on two fronts at once —
          that&apos;s why the bars ramp up.
        </p>
        <p>
          This is the &quot;RMD tax bomb&quot;: a big pre-tax balance left untouched forces ever-larger withdrawals,
          all taxed as ordinary income, which can push you into higher brackets and IRMAA tiers. Drawing pre-tax
          down earlier (or converting to Roth) in your low-tax years shrinks it. Roth IRAs have no RMDs at all.
        </p>
      </Info>

      {/* Roth conversion / rollover plan */}
      <SectionTitle>Roll pre-tax → Roth to defuse the bomb</SectionTitle>
      <Explainer>
        Your forecast with and without rolling pre-tax money to Roth in your low-tax years. Toggle it on to apply the
        rollovers to every chart and the table below.
      </Explainer>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Rollover plan {settings.useConversions ? "on" : "off"}</div>
            <p className="text-[12px] text-foreground/60">
              Rolls about {moneyCompact(conv.avgAnnualConversion)}/yr through {conv.windowEndYear} ({moneyCompact(conv.totalConverted)} total).
            </p>
          </div>
          <button
            onClick={() => updateSettings({ useConversions: !settings.useConversions })}
            className={`press shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              settings.useConversions ? "bg-gain/15 text-gain" : "bg-primary text-white"
            }`}
          >
            {settings.useConversions ? "✓ On" : "Turn on"}
          </button>
        </div>
        <p className="mb-2 mt-4 text-[13px] text-foreground/70">Worst-year RMD — the forced &quot;tax bomb&quot;:</p>
        <CompareBars
          items={[
            { label: "No rollovers", value: conv.peakRmdBaseline, color: HEX.tax },
            { label: "With rollovers", value: conv.peakRmdWithConversions, color: HEX.gain },
          ]}
          format={(n) => money(n)}
        />
        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniBox label="Rolled to Roth" value={moneyCompact(conv.totalConverted)} tone="roth" />
          <MiniBox
            label="After-tax wealth"
            value={(conv.estateGain >= 0 ? "+" : "−") + moneyCompact(Math.abs(conv.estateGain))}
            tone={conv.estateGain >= 0 ? "gain" : "tax"}
          />
          <MiniBox
            label="Lifetime tax"
            value={(conv.lifetimeTaxDelta >= 0 ? "+" : "−") + moneyCompact(Math.abs(conv.lifetimeTaxDelta))}
            tone={conv.lifetimeTaxDelta <= 0 ? "gain" : "tax"}
          />
        </div>
        <p className="mt-3 text-[12px] text-foreground/60">
          {conv.recommended
            ? "For your numbers, rolling pre-tax → Roth leaves more after-tax money and a far smaller forced-RMD spike. Recommended."
            : "For your numbers the gain is modest — rolling mainly trades a little lifetime tax for a smaller RMD spike and more tax-free Roth."}
        </p>
      </Card>

      {/* Strategy comparison */}
      <SectionTitle>Smart vs. conventional</SectionTitle>
      <Card>
        <p className="mb-3 text-[13px] text-foreground/70">Estimated lifetime tax (federal + Illinois) — same spending & assumptions:</p>
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
                The smart plan pays about <strong>{money(savings)}</strong>{" "}less in lifetime tax
                {estateGain > 1000 ? " " : "."}
              </>
            )}
            {estateGain > 1000 && (
              <>
                and leaves about <strong>{money(estateGain)}</strong>{" "}more after-tax wealth to your
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
      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
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
      <Explainer>
        The <strong className="text-deferred">RMD</strong> column is the minimum the IRS forces out of pre-tax
        that year — it&apos;s already included in the Pre-tax withdrawal, shown separately so you can see the
        mandatory floor.
      </Explainer>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-right text-[12px]">
          <thead className="text-foreground/50">
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-left">Yr / age</th>
              <th className="px-2 py-2">Pre-tax</th>
              <th className="px-2 py-2">RMD min</th>
              <th className="px-2 py-2">Broker</th>
              <th className="px-2 py-2">Roth</th>
              <th className="px-2 py-2">→Roth</th>
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
                <td className={`px-2 py-1.5 ${r.rmd > 0 ? "font-semibold text-deferred" : "text-foreground/30"}`}>
                  {r.rmd > 0 ? moneyCompact(r.rmd) : "—"}
                </td>
                <td className="px-2 py-1.5 text-taxable">{r.fromTaxable > 0 ? moneyCompact(r.fromTaxable) : "—"}</td>
                <td className="px-2 py-1.5 text-roth">{r.fromRoth > 0 ? moneyCompact(r.fromRoth) : "—"}</td>
                <td className={`px-2 py-1.5 ${r.conversion > 0 ? "font-semibold text-roth" : "text-foreground/30"}`}>
                  {r.conversion > 0 ? moneyCompact(r.conversion) : "—"}
                </td>
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

function MiniBox({ label, value, tone }: { label: string; value: string; tone?: "gain" | "tax" | "roth" }) {
  const color =
    tone === "gain" ? "text-gain" : tone === "tax" ? "text-tax" : tone === "roth" ? "text-roth" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/60 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</div>
      <div className={`tabular text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
