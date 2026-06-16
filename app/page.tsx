"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useStore } from "@/components/HouseholdProvider";
import { Card, PageTitle, Stat, StackedBar, Pill, Disclaimer, SectionTitle } from "@/components/ui";
import { sumBuckets, ageInYear } from "@/lib/accounts";
import { planYear, computeRmd } from "@/lib/optimizer";
import { money, moneyCompact, percent } from "@/lib/format";
import { rmdStartAge } from "@/lib/tax/constants";

export default function HomePage() {
  const { ready, household, settings } = useStore();
  const year = new Date().getFullYear();

  const data = useMemo(() => {
    const buckets = sumBuckets(household.accounts);
    const plan = planYear(household, {
      strategy: settings.strategy,
      bracketTarget: settings.bracketTarget,
      year,
    });
    const rmd = computeRmd(household, year);
    return { buckets, plan, rmd };
  }, [household, settings, year]);

  if (!ready) return <Loading />;

  const { buckets, plan, rmd } = data;
  const selfAge = ageInYear(household.self.birthYear, year);
  const spouseAge = ageInYear(household.spouse.birthYear, year);
  const selfRmdAge = rmdStartAge(household.self.birthYear);
  const spouseRmdAge = rmdStartAge(household.spouse.birthYear);

  return (
    <div>
      <PageTitle title="Retirement Tax Optimizer" subtitle="Filing jointly · federal tax · 2026 rules" />

      {/* Net worth + bucket split */}
      <Card>
        <div className="flex items-end justify-between">
          <Stat label="Total investable assets" value={money(buckets.total)} />
          <span className="text-right text-[11px] text-foreground/50">
            {household.self.label} {selfAge} · {household.spouse.label} {spouseAge}
          </span>
        </div>
        <div className="mt-3">
          <StackedBar
            segments={[
              { value: buckets.pretax, className: "bg-deferred", label: "Pre-tax" },
              { value: buckets.taxable, className: "bg-taxable", label: "Taxable" },
              { value: buckets.roth, className: "bg-roth", label: "Roth" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <BucketKey color="bg-deferred" label="Pre-tax" value={buckets.pretax} total={buckets.total} />
            <BucketKey color="bg-taxable" label="Taxable" value={buckets.taxable} total={buckets.total} />
            <BucketKey color="bg-roth" label="Roth" value={buckets.roth} total={buckets.total} />
          </div>
        </div>
      </Card>

      {/* This year's headline recommendation */}
      <SectionTitle hint={`tax year ${year}`}>This year&apos;s plan</SectionTitle>
      <Card>
        <p className="text-sm text-foreground/70">
          To spend <strong>{money(household.annualSpending)}</strong> after tax this year, the{" "}
          <strong>{settings.strategy === "smart" ? "smart bracket-fill" : settings.strategy}</strong> plan pulls:
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <DrawTile label="Pre-tax" amount={plan.withdrawals.pretax} tone="deferred" />
          <DrawTile label="Brokerage" amount={plan.withdrawals.taxable} tone="taxable" />
          <DrawTile label="Roth" amount={plan.withdrawals.roth} tone="roth" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone="tax">Est. federal tax {money(plan.tax.totalTax)}</Pill>
          <Pill>Effective {percent(plan.tax.effectiveRate)}</Pill>
          <Pill>Marginal {percent(plan.tax.marginalOrdinaryRate, 0)}</Pill>
        </div>
        <Link href="/plan" className="press mt-4 block rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-white">
          See the full breakdown →
        </Link>
      </Card>

      {/* RMD status */}
      <SectionTitle>Required withdrawals (RMDs)</SectionTitle>
      <Card>
        {rmd.total > 0 ? (
          <p className="text-sm text-foreground/75">
            You must take <strong className="text-deferred">{money(rmd.total)}</strong> out of pre-tax
            accounts this year. RMDs are mandatory and taxed as ordinary income — the planner takes
            them first.
          </p>
        ) : (
          <p className="text-sm text-foreground/75">
            No RMDs required yet. They begin at age <strong>{selfRmdAge}</strong> for{" "}
            {household.self.label} and <strong>{spouseRmdAge}</strong> for {household.spouse.label}{" "}
            (SECURE 2.0).
          </p>
        )}
        <p className="mt-2 text-[12px] text-foreground/55">
          🌱 Roth IRAs have <strong>no</strong> lifetime RMDs — you&apos;re never forced to drain
          them, which is why they&apos;re spent last.
        </p>
      </Card>

      <SectionTitle>Explore</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <NavTile href="/accounts" icon="💼" title="Accounts" sub="Your balances & basis" />
        <NavTile href="/plan" icon="🎯" title="This year" sub="Withdrawal plan" />
        <NavTile href="/projection" icon="📊" title="Forecast" sub={`Through age ${settings.endAge}`} />
        <NavTile href="/learn" icon="📖" title="Learn" sub="How the rules work" />
      </div>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function BucketKey({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-foreground/60">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label} {moneyCompact(value)} ({total > 0 ? percent(value / total, 0) : "0%"})
    </span>
  );
}

function DrawTile({ label, amount, tone }: { label: string; amount: number; tone: "deferred" | "taxable" | "roth" }) {
  const color = { deferred: "text-deferred", taxable: "text-taxable", roth: "text-roth" }[tone];
  return (
    <div className="rounded-xl border border-border bg-background/60 p-2 text-center">
      <div className="text-[11px] text-foreground/55">{label}</div>
      <div className={`tabular text-sm font-semibold ${color}`}>{moneyCompact(amount)}</div>
    </div>
  );
}

function NavTile({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <Link href={href} className="press rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 font-semibold">{title}</div>
      <div className="text-[12px] text-foreground/55">{sub}</div>
    </Link>
  );
}

function Loading() {
  return (
    <div className="space-y-3 pt-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl bg-foreground/5" />
      ))}
    </div>
  );
}
