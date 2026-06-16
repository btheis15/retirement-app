"use client";

import { useMemo, ReactNode } from "react";
import Link from "next/link";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, SectionTitle, Pill, Stat, Disclaimer, Callout, Explainer, Info } from "@/components/ui";
import { Donut, Legend, AnimatedNumber } from "@/components/charts";
import { planYear, STRATEGY_META, StrategyId, BracketTarget } from "@/lib/optimizer";
import { ordinaryBracketCeiling } from "@/lib/tax/engine";
import { detectOpportunities } from "@/lib/opportunities";
import { money, moneyCompact, percent } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { SOURCES } from "@/lib/sources";

const STRATEGIES: StrategyId[] = ["smart", "conventional", "proportional"];
const BRACKETS: BracketTarget[] = [0.12, 0.22, 0.24, 0.32];

const SPEND_MIN = 0;
const SPEND_MAX = 400_000;
const SPEND_STEP = 5_000;

const STEP_TONE: Record<"deferred" | "taxable" | "roth", string> = {
  deferred: "text-deferred",
  taxable: "text-taxable",
  roth: "text-roth",
};

const STRATEGY_SHORT: Record<StrategyId, string> = {
  smart: "Fills low brackets early to cut lifetime tax. Often best — compare on the Compare tab to be sure.",
  conventional: "The common rule of thumb. Simple, and sometimes hard to beat.",
  proportional: "A little from everything. Simplest, rarely tax-optimal.",
};

export default function PlanPage() {
  const { ready, household, settings, updateSettings, updateHousehold } = useStore();
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
  const totalDraw = w.pretax + w.taxable + w.roth;
  const voluntaryPretax = Math.max(0, w.pretax - plan.rmd);
  const coveredByIncome = totalDraw < 0.5;

  const sourceSegments = [
    { label: "Pre-tax (IRA/401k)", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);

  const incomeSegments = [
    { label: "Social Security", value: plan.fixed.socialSecurity, color: HEX.ss },
    { label: "Pension", value: plan.fixed.pension, color: HEX.primary },
    { label: "Dividends", value: plan.fixed.dividends, color: HEX.gain },
    { label: "Pre-tax withdrawals", value: w.pretax, color: HEX.deferred },
    { label: "Brokerage", value: w.taxable, color: HEX.taxable },
    { label: "Roth (tax-free)", value: w.roth, color: HEX.roth },
  ].filter((s) => s.value > 0.5);

  // ---- Plain-English step list: exactly what to do, in order. ----
  const steps: { label: string; amount: number; detail: string; tone: "deferred" | "taxable" | "roth" }[] = [];
  if (plan.rmd > 0.5) {
    steps.push({
      label: "Take your required withdrawal (RMD)",
      amount: plan.rmd,
      detail:
        "The IRS forces this much out of your pre-tax accounts this year. It's taxed as ordinary income, so it always comes out first.",
      tone: "deferred",
    });
  }
  if (voluntaryPretax > 0.5) {
    steps.push({
      label: plan.rmd > 0.5 ? "Withdraw a little more from pre-tax" : "Withdraw from pre-tax (IRA / 401k)",
      amount: voluntaryPretax,
      detail: `Pull pre-tax dollars up to the ${percent(settings.bracketTarget, 0)} tax bracket. Taking these "cheap" dollars now means smaller forced withdrawals — and a smaller tax bill — later.`,
      tone: "deferred",
    });
  }
  if (w.taxable > 0.5) {
    steps.push({
      label: "Sell from your brokerage",
      amount: w.taxable,
      detail: "Only the gain portion is taxed, usually at the lower long-term capital-gains rate (often 0–15%).",
      tone: "taxable",
    });
  }
  if (w.roth > 0.5) {
    steps.push({
      label: "Tap your Roth (tax-free)",
      amount: w.roth,
      detail: "Used last on purpose: Roth comes out tax-free and is never forced out, so every year it stays invested is tax-free growth.",
      tone: "roth",
    });
  }

  return (
    <div>
      <PageTitle title={`What to do in ${year}`} subtitle="Your plan in plain English: how much to spend, where to pull it from, and the tax." />

      {/* ---------- THE HEADLINE: what to do ---------- */}
      <Callout tone="good" icon="🧭" title="Your move this year">
        {coveredByIncome ? (
          <>
            Good news — your Social Security, pension and dividends already cover your{" "}
            <strong>{money(plan.spendingTarget)}</strong> of spending this year. You don&apos;t need to
            pull from any account{plan.rmd > 0.5 ? " beyond the required RMD below" : ""}.
          </>
        ) : (
          <>
            To spend <strong>{money(plan.spendingTarget)}</strong> after tax this year, withdraw about{" "}
            <strong>{money(totalDraw)}</strong> total from your accounts (the steps below), and set aside
            roughly <strong>{money(plan.tax.totalTax)}</strong> for federal tax.
          </>
        )}
      </Callout>

      {/* ---------- Spending control ---------- */}
      <SectionTitle>How much do you want to spend?</SectionTitle>
      <Explainer>This is your target — the money you actually want in your pocket after tax. Drag it and watch the plan and tax update.</Explainer>
      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-foreground/60">Yearly spending (after tax)</span>
          <span className="tabular text-2xl font-bold text-primary">{money(plan.spendingTarget)}</span>
        </div>
        <input
          type="range"
          min={SPEND_MIN}
          max={SPEND_MAX}
          step={SPEND_STEP}
          value={Math.min(SPEND_MAX, household.annualSpending)}
          onChange={(e) => updateHousehold({ annualSpending: Number(e.target.value) })}
          className="mt-3 w-full accent-primary"
          aria-label="Yearly spending"
        />
        <div className="mt-1 flex justify-between text-[11px] text-foreground/45">
          <span>{moneyCompact(SPEND_MIN)}</span>
          <span>{moneyCompact(SPEND_MAX)}+</span>
        </div>
      </Card>

      {/* ---------- The step-by-step ---------- */}
      <SectionTitle>Do this, in order</SectionTitle>
      <Explainer>We always satisfy required withdrawals first, then pull from the most tax-friendly source next, saving tax-free Roth for last.</Explainer>
      <Card>
        {steps.length === 0 ? (
          <p className="text-sm text-foreground/75">
            Nothing to withdraw — your guaranteed income covers your spending. Any surplus can be reinvested
            in your brokerage.
          </p>
        ) : (
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <span className={`tabular shrink-0 font-bold ${STEP_TONE[s.tone]}`}>{money(s.amount)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/65">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {w.roth < 0.5 && steps.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-roth/5 px-3 py-2 text-[12px] text-roth">
            🌱 Leave your Roth untouched this year — it keeps growing tax-free.
          </p>
        )}

        <div className="mt-4 border-t border-border pt-3 text-[13px] text-foreground/80">
          <strong>Bottom line:</strong> you keep <strong>{money(plan.spendingTarget)}</strong> to spend
          after paying about <strong className="text-tax">{money(plan.tax.totalTax)}</strong> in federal
          tax — that&apos;s {percent(plan.tax.effectiveRate)} of your total income for the year.
        </div>
      </Card>

      <Info q="Why this order? (pre-tax → brokerage → Roth)" sources={[SOURCES.rmd, SOURCES.rothNoRmd, SOURCES.capGains]}>
        <p className="mb-1.5">Your accounts fall into three tax &quot;buckets,&quot; and the bucket — not the brand — sets the order:</p>
        <ul className="space-y-1">
          <li><strong className="text-deferred">Pre-tax</strong> (Traditional IRA / 401k): never taxed yet, so every dollar out is ordinary income. The IRS forces minimum withdrawals (RMDs) starting at 73–75.</li>
          <li><strong className="text-taxable">Brokerage</strong> (taxable): only the <em>gain</em> is taxed, usually at the lower capital-gains rate. No forced withdrawals.</li>
          <li><strong className="text-roth">Roth</strong>: already taxed, so it comes out tax-free and is <em>never</em> forced out — which is why it&apos;s spent last.</li>
        </ul>
      </Info>

      {/* ---------- Source donut ---------- */}
      <SectionTitle>Where the money comes from</SectionTitle>
      <Explainer>Each slice is an account we&apos;d draw on to fund your spending this year.</Explainer>
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

      {/* ---------- Tax bill ---------- */}
      <SectionTitle>What you&apos;ll owe in tax</SectionTitle>
      <Explainer>
        Your <em>effective</em> rate is your average across all income. Your <em>marginal</em> rate is what
        the very next dollar would be taxed at.
      </Explainer>
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
        <Info q="Effective vs. marginal rate — what's the difference?" sources={[SOURCES.brackets2026]}>
          Tax brackets are tiers, so not every dollar is taxed the same. Your <strong>effective rate</strong> is
          the average across <em>all</em> your income ({percent(plan.tax.effectiveRate)} here) — the most honest
          measure of your tax burden. Your <strong>marginal rate</strong> ({percent(plan.tax.marginalOrdinaryRate, 0)})
          is what only the <em>next</em> dollar of ordinary income would be taxed at. Aiming for a low effective
          rate over your lifetime is the real goal.
        </Info>
        <Info q="What do these colored tags mean?" sources={[SOURCES.ssTax, SOURCES.capGains, SOURCES.niit, SOURCES.irmaa]}>
          <ul className="space-y-1">
            <li><strong>SS taxable</strong>: the share of your Social Security that counts as taxable income (0–85%).</li>
            <li><strong>Cap-gains rate</strong>: the rate on your long-term investment gains (0%, 15%, or 20%).</li>
            <li><strong>NIIT</strong>: an extra 3.8% tax on investment income once income tops $250k (joint).</li>
            <li><strong>IRMAA</strong>: which Medicare premium tier this income lands in — higher income = higher Part B/D premiums two years later.</li>
          </ul>
        </Info>
      </Card>

      {/* ---------- Full income picture ---------- */}
      <SectionTitle>Full income picture</SectionTitle>
      <Explainer>Everything the IRS counts as income this year, and how it turns into your tax bill, line by line.</Explainer>
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

      {/* ---------- Why ---------- */}
      <SectionTitle>Why this plan</SectionTitle>
      <Explainer>The reasoning behind the steps above, in your own numbers.</Explainer>
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

      {/* ---------- Opportunities ---------- */}
      {opportunities.length > 0 && (
        <>
          <SectionTitle hint={`${opportunities.length} ideas`}>Opportunities to save</SectionTitle>
          <Explainer>Optional moves that could lower your tax — each links to the official IRS / Medicare source.</Explainer>
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

      {/* ---------- Strategy controls (explained) ---------- */}
      <SectionTitle>Change the strategy</SectionTitle>
      <Explainer>
        A &quot;strategy&quot; is just the <em>order</em> we pull money from your accounts — it&apos;s a method, not a
        dollar amount or a tax rate. Smart is recommended.
      </Explainer>
      <Card>
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
        <p className="mt-2 text-[13px] font-medium text-foreground/70">{STRATEGY_SHORT[settings.strategy]}</p>
        <p className="mt-1 text-[12px] text-foreground/55">{STRATEGY_META[settings.strategy].blurb}</p>

        <Info q="What does &quot;Smart (bracket-fill)&quot; actually mean?" sources={[SOURCES.brackets2026, SOURCES.rmd, SOURCES.rothConversion]}>
          <p className="mb-1.5">
            It&apos;s a <strong>method for choosing which accounts to draw from</strong> — not a number, a total,
            or a tax rate. Each year it:
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Takes any <strong>required</strong> withdrawal (RMD) first.</li>
            <li>Then <strong>tops up</strong> with pre-tax dollars only until you reach the top of a low tax bracket you choose (e.g. 22%).</li>
            <li>Covers the rest from your brokerage.</li>
            <li>Leaves tax-free Roth for last.</li>
          </ol>
          <p className="mt-1.5">
            The point: deliberately pay a little tax now at a <em>low</em> rate so you don&apos;t get hit with
            large, highly-taxed forced withdrawals later. It usually produces the lowest <em>lifetime</em> tax —
            which the Scenarios page lets you verify against the alternatives.
          </p>
        </Info>

        {settings.strategy === "smart" && (
          <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
            <div className="text-[13px] font-semibold">Fill pre-tax up to this tax bracket</div>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/60">
              Your income is taxed in tiers called brackets. This control sets the <strong>highest rate
              you&apos;re willing to pay</strong> to voluntarily pull extra pre-tax money now. We add pre-tax
              withdrawals until your taxable income reaches the top of the bracket you pick, then stop and use
              other accounts. Pick a higher bracket to move more out now (more tax today, smaller forced
              withdrawals later). <strong>This is not your overall tax rate.</strong>
            </p>
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {BRACKETS.map((b) => (
                <button
                  key={b}
                  onClick={() => updateSettings({ bracketTarget: b })}
                  className={`press rounded-xl border py-2 text-center ${
                    settings.bracketTarget === b
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground/70"
                  }`}
                >
                  <div className="text-sm font-bold">{Math.round(b * 100)}%</div>
                  <div className="text-[9px] leading-tight text-foreground/45">
                    to {moneyCompact(ordinaryBracketCeiling(b))}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-foreground/55">
              Filling to <strong>{percent(settings.bracketTarget, 0)}</strong> means we keep pulling pre-tax
              dollars until your taxable income reaches about{" "}
              <strong>{money(ordinaryBracketCeiling(settings.bracketTarget))}</strong>, then switch to other
              accounts.
            </p>
            <Info q="Show me an example of what this does" sources={[SOURCES.brackets2026, SOURCES.rothConversion]}>
              <p className="mb-1.5">
                Say your other income leaves room in the 12% bracket. Picking <strong>12%</strong> tells the
                planner: &quot;pull pre-tax money until I&apos;ve used up the 12% bracket, then stop.&quot; Those
                dollars are taxed at just 12%.
              </p>
              <p>
                Pick <strong>24%</strong> instead and it pulls more pre-tax now — taxed up to 24% today, but it
                shrinks the pre-tax balance that would later be force-withdrawn (RMDs) and possibly taxed even
                higher. So the cards aren&apos;t your tax rate — they&apos;re the <em>ceiling</em> you let
                voluntary pre-tax withdrawals reach. Higher = more out now, less forced out later.
              </p>
            </Info>
          </div>
        )}

        <Link
          href="/scenarios"
          className="press mt-4 block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary"
        >
          Compare strategies over your whole life →
        </Link>
      </Card>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function oppBorder(tone: "good" | "warn" | "info"): string {
  return tone === "warn" ? "border-l-tax" : tone === "good" ? "border-l-gain" : "border-l-ss";
}

function Row({ label, value, bold, tone }: { label: string; value: ReactNode; bold?: boolean; tone?: "tax" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? "font-semibold" : "text-foreground/65"}`}>{label}</span>
      <span className={`tabular ${bold ? "font-semibold" : ""} ${tone === "tax" ? "text-tax" : ""}`}>{value}</span>
    </div>
  );
}
