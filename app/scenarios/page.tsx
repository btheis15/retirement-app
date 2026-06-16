"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Disclaimer, Callout, Explainer, Info } from "@/components/ui";
import { CompareBars } from "@/components/charts";
import { projectLifetime } from "@/lib/projection";
import { StrategyId, BracketTarget } from "@/lib/optimizer";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

interface PlanDef {
  id: string;
  label: string;
  how: string;
  strategy: StrategyId;
  bracketTarget: BracketTarget;
}

const PLANS: PlanDef[] = [
  {
    id: "conv",
    label: "Conventional order",
    how: "Spend brokerage first, then pre-tax, and leave Roth for last.",
    strategy: "conventional",
    bracketTarget: 0.22,
  },
  {
    id: "s12",
    label: "Smart — fill to 12%",
    how: "Take RMDs, top up pre-tax only into the 12% bracket, then brokerage, Roth last.",
    strategy: "smart",
    bracketTarget: 0.12,
  },
  {
    id: "s22",
    label: "Smart — fill to 22%",
    how: "Same idea, but fill pre-tax up into the 22% bracket — a bit more tax now.",
    strategy: "smart",
    bracketTarget: 0.22,
  },
  {
    id: "s24",
    label: "Smart — fill to 24%",
    how: "Fill pre-tax up into the 24% bracket — the most tax now, the smallest pre-tax balance later.",
    strategy: "smart",
    bracketTarget: 0.24,
  },
];

const RETURNS = [
  { id: "cons", label: "Conservative", rate: 0.035 },
  { id: "mod", label: "Moderate", rate: 0.05 },
  { id: "opt", label: "Optimistic", rate: 0.07 },
] as const;

export default function ScenariosPage() {
  const { ready, household, settings, updateSettings } = useStore();

  const scn = useMemo(() => {
    const base = {
      returnRate: settings.returnRate,
      inflationRate: settings.inflationRate,
      endAge: settings.endAge,
    };
    return PLANS.map((p) => {
      const r = projectLifetime(household, { ...base, strategy: p.strategy, bracketTarget: p.bracketTarget });
      const gross = r.rows.reduce((s, row) => s + row.netCash + row.tax, 0);
      return {
        ...p,
        lifetimeTax: r.lifetimeTax,
        taxPct: gross > 0 ? r.lifetimeTax / gross : 0,
        netWealth: r.endingEstateAfterTax,
        depleted: r.depleted,
      };
    });
  }, [household, settings.returnRate, settings.inflationRate, settings.endAge]);

  if (!ready) return <div className="h-screen" />;

  const mostWealth = scn.reduce((a, b) => (b.netWealth > a.netWealth ? b : a));
  const lowestTax = scn.reduce((a, b) => (b.lifetimeTax < a.lifetimeTax ? b : a));
  const differ = mostWealth.id !== lowestTax.id;
  const wealthGap = mostWealth.netWealth - lowestTax.netWealth;
  const extraTax = mostWealth.lifetimeTax - lowestTax.lifetimeTax;

  const ranked = [...scn].sort((a, b) => b.netWealth - a.netWealth);
  const isActive = (p: PlanDef) =>
    settings.strategy === p.strategy && (p.strategy !== "smart" || settings.bracketTarget === p.bracketTarget);

  return (
    <div>
      <PageTitle title="Compare your options" subtitle="Lowest tax isn't always the goal — the most money left is. See both." />

      {/* The big idea */}
      <Callout tone="info" icon="⚖️" title="What actually matters">
        It&apos;s tempting to chase the smallest tax bill. But the real goal is the <strong>most money left in
        your pocket after taxes</strong>, over your whole life. Sometimes paying a bit more tax now leaves you
        <em> richer</em> later — and the lowest-tax plan can quietly leave you poorer. Below, every plan is
        scored both ways.
      </Callout>

      <Info q="How can paying more tax leave me with more money?" sources={[SOURCES.rothConversion, SOURCES.rmd]}>
        <p className="mb-1.5">
          Pre-tax accounts (IRA/401k) have a catch: the IRS eventually <em>forces</em> big withdrawals (RMDs)
          and taxes them as ordinary income — often at a higher rate than you&apos;d pay today.
        </p>
        <p>
          By voluntarily pulling (or converting to Roth) some pre-tax money now at a <em>low</em> rate, you pay
          a little more tax today but shrink those future forced withdrawals and let tax-free Roth compound.
          The total tax can be higher in one column yet leave more after-tax wealth in the other. That&apos;s
          the trade-off this page makes visible.
        </p>
      </Info>

      {/* Return assumption */}
      <SectionTitle hint={`spending ${moneyCompact(household.annualSpending)}/yr · to age ${settings.endAge}`}>
        Assumed yearly return
      </SectionTitle>
      <Explainer>Returns matter as much as taxes. Bump this up and watch how every plan&apos;s ending wealth grows.</Explainer>
      <div className="flex gap-2">
        {RETURNS.map((s) => (
          <button
            key={s.id}
            onClick={() => updateSettings({ returnRate: s.rate })}
            className={`press flex-1 rounded-xl border py-2 text-center ${
              Math.abs(settings.returnRate - s.rate) < 0.001 ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            <div className="text-[12px] font-semibold">{s.label}</div>
            <div className="text-[11px] text-foreground/55">{percent(s.rate, 1)}/yr</div>
          </button>
        ))}
      </div>

      {/* Headline winner */}
      <SectionTitle>The bottom line</SectionTitle>
      <Callout tone="good" icon="🏆" title="Most money left after tax">
        <strong>{mostWealth.label}</strong> leaves you the most — about{" "}
        <strong>{money(mostWealth.netWealth)}</strong> after tax at age {settings.endAge}.
        {differ ? (
          <>
            {" "}It isn&apos;t the lowest-tax plan, but it comes out ahead.
          </>
        ) : (
          <>
            {" "}And it&apos;s also the lowest-tax plan, so the choice is easy at these assumptions.
          </>
        )}
      </Callout>

      {/* After-tax wealth bars */}
      <SectionTitle>After-tax money left at age {settings.endAge}</SectionTitle>
      <Explainer>The true bottom line — what you&apos;d actually have to spend or leave behind, taxes already accounted for. Higher is better.</Explainer>
      <Card>
        <CompareBars
          items={ranked.map((p) => ({
            label: p.label,
            value: p.netWealth,
            color: p.id === mostWealth.id ? HEX.gain : HEX.taxable,
          }))}
          format={(n) => money(n)}
        />
        <Info q="How is &quot;after-tax money left&quot; calculated?">
          A pre-tax dollar still owes income tax when it&apos;s eventually withdrawn, so to compare fairly we
          discount the leftover pre-tax balance by an assumed 22% future rate, knock 15% off unrealized
          brokerage gains, and count Roth at full value (it&apos;s already tax-free). It&apos;s an estimate for
          comparison — not a prediction.
        </Info>
      </Card>

      {/* Lifetime tax bars */}
      <SectionTitle>Total lifetime federal tax</SectionTitle>
      <Explainer>Every dollar of federal tax paid across the whole projection. Lower looks better here — but remember it&apos;s only half the story.</Explainer>
      <Card>
        <CompareBars
          items={ranked.map((p) => ({
            label: p.label,
            value: p.lifetimeTax,
            color: p.id === lowestTax.id ? HEX.gain : HEX.tax,
          }))}
          format={(n) => money(n)}
        />
      </Card>

      {/* Per-plan detail */}
      <SectionTitle>Every plan, side by side</SectionTitle>
      <Explainer>Tap &quot;Use this plan&quot; to apply it everywhere else in the app.</Explainer>
      <div className="space-y-2">
        {ranked.map((p) => (
          <Card as="div" key={p.id} className={isActive(p) ? "border-primary/40 bg-primary/[0.03]" : ""}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{p.label}</div>
                <p className="mt-0.5 text-[12px] text-foreground/60">{p.how}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {p.id === mostWealth.id && <Pill tone="gain">Most wealth</Pill>}
                {p.id === lowestTax.id && <Pill tone="ss">Lowest tax</Pill>}
                {p.depleted && <Pill tone="tax">Runs short</Pill>}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-background/60 p-2">
                <div className="text-[11px] text-foreground/55">Lifetime tax</div>
                <div className="tabular text-sm font-semibold text-tax">{moneyCompact(p.lifetimeTax)}</div>
                <div className="text-[10px] text-foreground/45">{percent(p.taxPct)} of income</div>
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-2">
                <div className="text-[11px] text-foreground/55">After-tax money left</div>
                <div className="tabular text-sm font-semibold text-gain">{moneyCompact(p.netWealth)}</div>
                <div className="text-[10px] text-foreground/45">at age {settings.endAge}</div>
              </div>
            </div>
            <button
              onClick={() => updateSettings({ strategy: p.strategy, bracketTarget: p.bracketTarget })}
              disabled={isActive(p)}
              className={`press mt-3 w-full rounded-xl py-2 text-sm font-semibold ${
                isActive(p) ? "bg-primary/10 text-primary" : "bg-primary text-white"
              }`}
            >
              {isActive(p) ? "✓ Currently active" : "Use this plan"}
            </button>
          </Card>
        ))}
      </div>

      {/* The trade-off in their numbers */}
      <SectionTitle>What the numbers say for you</SectionTitle>
      <Card>
        {differ ? (
          <p className="text-[13px] leading-relaxed text-foreground/75">
            For your situation, <strong>{mostWealth.label}</strong> pays about{" "}
            <strong className="text-tax">{money(extraTax)}</strong> more in lifetime tax than the lowest-tax
            plan ({lowestTax.label}), yet leaves you roughly{" "}
            <strong className="text-gain">{money(wealthGap)}</strong> <strong>more</strong> after tax. That&apos;s
            the headline: chasing the smallest tax bill alone would have cost you money here. Optimize for the
            green column, not the red one.
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-foreground/75">
            At your current assumptions, <strong>{mostWealth.label}</strong> wins on both counts — it has the
            lowest lifetime tax <em>and</em> leaves the most after-tax money. The plans diverge more as
            spending, returns, or your pre-tax balance grow, so it&apos;s worth re-checking if those change.
          </p>
        )}
      </Card>

      <Link
        href="/projection"
        className="press mt-4 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary"
      >
        See the year-by-year forecast for the active plan →
      </Link>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
