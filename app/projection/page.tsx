"use client";

import { useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Stat, Pill, Disclaimer } from "@/components/ui";
import { StackedArea, Bars, CompareBars, AnimatedNumber } from "@/components/charts";
import { projectLifetime } from "@/lib/projection";
import { detectMilestones } from "@/lib/milestones";
import { STRATEGY_META } from "@/lib/optimizer";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";

const SCENARIOS = [
  { id: "cons", label: "Conservative", rate: 0.035 },
  { id: "mod", label: "Moderate", rate: 0.05 },
  { id: "opt", label: "Optimistic", rate: 0.07 },
] as const;

export default function ProjectionPage() {
  const { ready, household, settings, updateSettings } = useStore();

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

  return (
    <div>
      <PageTitle title="Lifetime forecast" subtitle={`Year-by-year through age ${settings.endAge}, with growth & inflation.`} />

      {/* Scenario controls */}
      <div className="flex gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => updateSettings({ returnRate: s.rate })}
            className={`press flex-1 rounded-xl border py-2 text-center ${
              Math.abs(settings.returnRate - s.rate) < 0.001
                ? "border-primary bg-primary/10 text-primary"
                : "border-border"
            }`}
          >
            <div className="text-[12px] font-semibold">{s.label}</div>
            <div className="text-[11px] text-foreground/55">{percent(s.rate, 1)}/yr</div>
          </button>
        ))}
      </div>
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
