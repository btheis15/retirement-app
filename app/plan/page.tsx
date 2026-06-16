"use client";

import { useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Stat, Disclaimer } from "@/components/ui";
import { Donut, Legend, AnimatedNumber } from "@/components/charts";
import { planYear, STRATEGY_META, StrategyId, BracketTarget } from "@/lib/optimizer";
import { detectOpportunities } from "@/lib/opportunities";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";

const STRATEGIES: StrategyId[] = ["smart", "conventional", "proportional"];
const BRACKETS: BracketTarget[] = [0.12, 0.22, 0.24, 0.32];

export default function PlanPage() {
  const { ready, household, settings, updateSettings } = useStore();
  const year = new Date().getFullYear();

  const plan = useMemo(
    () => planYear(household, { strategy: settings.strategy, bracketTarget: settings.bracketTarget, year }),
    [household, settings, year],
  );
  const opportunities = useMemo(
    () => detectOpportunities(household, plan, settings.bracketTarget),
    [household, plan, settings.bracketTarget],
  );

  if (!ready) return <div className="h-screen" />;

  const w = plan.withdrawals;
  const sourceSegments = [
    { label: "Pre-tax (IRA/401k)", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);
  const totalDraw = w.pretax + w.taxable + w.roth;

  const incomeSegments = [
    { label: "Social Security", value: plan.fixed.socialSecurity, color: HEX.ss },
    { label: "Pension", value: plan.fixed.pension, color: HEX.primary },
    { label: "Dividends", value: plan.fixed.dividends, color: HEX.gain },
    { label: "Pre-tax withdrawals", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);

  return (
    <div>
      <PageTitle title={`${year} withdrawal plan`} subtitle="Where to pull money from this year — and the tax bill." />

      {/* Strategy picker */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {STRATEGIES.map((s) => (
          <button
            key={s}
            onClick={() => updateSettings({ strategy: s })}
            className={`press whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ${
              settings.strategy === s ? "bg-primary text-white" : "border border-border bg-card text-foreground/70"
            }`}
          >
            {STRATEGY_META[s].label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-foreground/60">{STRATEGY_META[settings.strategy].blurb}</p>

      {settings.strategy === "smart" && (
        <div className="mt-3">
          <span className="text-[12px] font-medium text-foreground/60">Fill pre-tax up to this bracket:</span>
          <div className="mt-1.5 flex gap-2">
            {BRACKETS.map((b) => (
              <button
                key={b}
                onClick={() => updateSettings({ bracketTarget: b })}
                className={`press flex-1 rounded-xl border py-2 text-sm ${
                  settings.bracketTarget === b
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-border"
                }`}
              >
                {Math.round(b * 100)}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Source donut */}
      <SectionTitle>Where the money comes from</SectionTitle>
      <Card>
        {totalDraw > 0.5 ? (
          <>
            <Donut
              segments={sourceSegments}
              centerTop="Withdrawn"
              centerMain={moneyCompact(totalDraw)}
              centerSub="this year"
            />
            <Legend segments={sourceSegments} total={totalDraw} />
          </>
        ) : (
          <p className="text-sm text-foreground/70">
            Your Social Security, pension, dividends{plan.rmd > 0 ? " and required RMD" : ""} already cover
            this year&apos;s spending — no extra withdrawals needed.
          </p>
        )}
      </Card>

      {/* The bottom line */}
      <SectionTitle>The bottom line</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-y-4">
          <Stat label="After-tax spending" value={money(plan.spendingTarget)} />
          <Stat label="Est. federal tax" tone="tax" value={<AnimatedNumber value={plan.tax.totalTax} />} />
          <Stat label="Effective rate" value={percent(plan.tax.effectiveRate)} />
          <Stat label="Marginal rate" value={percent(plan.tax.marginalOrdinaryRate, 0)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.rmd > 0 && <Pill tone="deferred">RMD {money(plan.rmd)}</Pill>}
          <Pill tone="ss">
            SS taxable {plan.fixed.socialSecurity > 0 ? percent(plan.tax.taxableSocialSecurity / plan.fixed.socialSecurity, 0) : "0%"}
          </Pill>
          <Pill tone="taxable">Cap-gains rate {percent(plan.tax.capitalGainsRate, 0)}</Pill>
          {plan.tax.niit > 0 && <Pill tone="tax">NIIT {money(plan.tax.niit)}</Pill>}
          <Pill tone={plan.tax.irmaa.perPerson > 0 ? "tax" : "gain"}>{plan.tax.irmaa.label}</Pill>
        </div>
      </Card>

      {/* Full income picture */}
      <SectionTitle>Full income picture</SectionTitle>
      <Card>
        <Donut
          segments={incomeSegments}
          size={168}
          thickness={20}
          centerTop="Gross income"
          centerMain={moneyCompact(plan.grossInflow)}
        />
        <Legend segments={incomeSegments} total={plan.grossInflow} />
        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
          <Row label="Adjusted gross income (AGI)" value={money(plan.tax.agi)} />
          <Row label="Taxable Social Security" value={money(plan.tax.taxableSocialSecurity)} />
          <Row label="Deductions" value={`− ${money(plan.tax.deductions)}`} />
          <Row label="Taxable income" value={money(plan.tax.taxableIncome)} bold />
          <Row label="Ordinary income tax" value={money(plan.tax.ordinaryTax)} />
          <Row label="Capital gains tax" value={money(plan.tax.capitalGainsTax)} />
          {plan.tax.niit > 0 && <Row label="Net investment income tax" value={money(plan.tax.niit)} />}
          <Row label="Total federal tax" value={money(plan.tax.totalTax)} bold tone="tax" />
        </div>
      </Card>

      {/* Why */}
      <SectionTitle>Why this plan</SectionTitle>
      <Card>
        <ul className="space-y-2 text-[13px] text-foreground/75">
          {plan.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Opportunities — actionable moves with sources */}
      {opportunities.length > 0 && (
        <>
          <SectionTitle hint={`${opportunities.length} ideas`}>Opportunities to save</SectionTitle>
          <div className="space-y-2">
            {opportunities.map((o) => (
              <Card as="div" key={o.id} className={`border-l-4 ${oppBorder(o.tone)}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg">{o.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{o.title}</div>
                    {o.impact && (
                      <div className="mt-0.5">
                        <Pill tone={o.tone === "warn" ? "tax" : "gain"}>{o.impact}</Pill>
                      </div>
                    )}
                    <p className="mt-1.5 text-[13px] text-foreground/70">{o.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {o.sources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary underline decoration-primary/30 underline-offset-2"
                        >
                          {s.label} ↗
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function oppBorder(tone: "good" | "warn" | "info"): string {
  return tone === "warn" ? "border-l-tax" : tone === "good" ? "border-l-gain" : "border-l-ss";
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "tax" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? "font-semibold" : "text-foreground/65"}`}>{label}</span>
      <span className={`tabular ${bold ? "font-semibold" : ""} ${tone === "tax" ? "text-tax" : ""}`}>{value}</span>
    </div>
  );
}
