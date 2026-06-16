"use client";

import { useState } from "react";
import { Card, PageTitle, Disclaimer } from "@/components/ui";
import { SOURCES, Source } from "@/lib/sources";

interface Topic {
  icon: string;
  title: string;
  body: string[];
  sources: Source[];
}

const TOPICS: Topic[] = [
  {
    icon: "🪣",
    title: "The three tax buckets",
    body: [
      "Every account falls into one of three tax treatments, and that — not the brand or fund — drives the withdrawal order.",
      "Pre-tax (Traditional IRA, 401(k), rollover): you never paid tax on this money, so every dollar out is ordinary income. These are subject to RMDs.",
      "Roth (Roth IRA / 401(k)): already taxed, so withdrawals are tax-free, and a Roth IRA has no lifetime RMDs for the owner.",
      "Taxable (brokerage, savings): you only owe tax on the gain when you sell, usually at preferential long-term capital-gains rates. No RMDs.",
    ],
    sources: [SOURCES.rmd, SOURCES.rothNoRmd, SOURCES.capGains],
  },
  {
    icon: "📌",
    title: "Required Minimum Distributions (RMDs)",
    body: [
      "Once you reach RMD age, the IRS forces a minimum withdrawal from pre-tax accounts each year, taxed as ordinary income — whether you need the money or not.",
      "Under SECURE 2.0, RMDs start at age 73 if you were born 1951–1959, and age 75 if born 1960 or later.",
      "The amount is your prior year-end balance divided by an IRS life-expectancy factor (the Uniform Lifetime Table). As you age the factor shrinks, so RMDs grow.",
      "Key point: Roth IRAs are exempt — there is no lifetime RMD on a Roth IRA you own. That's why the planner spends Roth last.",
    ],
    sources: [SOURCES.rmdAge, SOURCES.rmd, SOURCES.rothNoRmd],
  },
  {
    icon: "💵",
    title: "How Social Security is taxed",
    body: [
      "Anywhere from 0% to 85% of your Social Security benefits are taxable, depending on your other income.",
      "The IRS looks at 'provisional income' — your other income plus half your benefits. Below $32,000 (married filing jointly) none is taxed; above $44,000, up to 85% is.",
      "This is why pulling a large pre-tax withdrawal can be expensive: it can drag more of your Social Security into being taxed at the same time — a hidden marginal rate.",
    ],
    sources: [SOURCES.ssTax],
  },
  {
    icon: "📈",
    title: "Capital gains: the 0% / 15% / 20% rates",
    body: [
      "Long-term gains (assets held over a year) and qualified dividends get their own lower rate schedule, stacked on top of your ordinary income.",
      "Filing jointly in 2026, gains are taxed at 0% until taxable income reaches about $98,900, then 15%, then 20% at the top.",
      "That 0% band is a real opportunity: in low-income years you can sell winners, pay no federal tax on the gain, and reset your basis higher.",
    ],
    sources: [SOURCES.capGains, SOURCES.brackets2026],
  },
  {
    icon: "🎯",
    title: "Filling the brackets (and Roth conversions)",
    body: [
      "Tax brackets are progressive: only the dollars inside a bracket pay that bracket's rate. The cheapest dollars to pull are the ones that fill up a low bracket you haven't used.",
      "The 'smart' strategy takes RMDs first, then deliberately pulls pre-tax money up to the top of a target bracket (say 12% or 22%), then uses the brokerage, and saves tax-free Roth for last.",
      "The same logic powers Roth conversions: in your low-income years (after work, before Social Security and RMDs), converting pre-tax to Roth at today's low rate can save a lot versus letting it come out later as large, highly-taxed RMDs.",
    ],
    sources: [SOURCES.brackets2026, SOURCES.rothConversion, SOURCES.rmd],
  },
  {
    icon: "🚧",
    title: "Medicare IRMAA surcharges",
    body: [
      "If your income crosses certain thresholds, you pay an income-related surcharge (IRMAA) on top of standard Medicare Part B and Part D premiums — for both spouses.",
      "It's based on your tax return from two years earlier, and it's a cliff: one dollar over a threshold triggers the whole surcharge tier.",
      "Keeping a withdrawal just under a threshold — by using Roth or cash for the last slice of spending — can save thousands a year in premiums.",
    ],
    sources: [SOURCES.irmaa],
  },
  {
    icon: "🧾",
    title: "Net Investment Income Tax (NIIT)",
    body: [
      "An extra 3.8% tax applies to investment income (interest, dividends, capital gains) once modified AGI exceeds $250,000 for joint filers.",
      "It's another reason large taxable withdrawals or interest-heavy holdings can quietly raise your effective rate.",
    ],
    sources: [SOURCES.niit],
  },
  {
    icon: "🧓",
    title: "Deductions for age 65+",
    body: [
      "At 65+, each spouse gets an additional standard deduction on top of the regular one.",
      "For 2025–2028 there's also a temporary 'senior bonus' deduction of up to $6,000 per qualifying person, which phases out at higher income — the planner accounts for both.",
    ],
    sources: [SOURCES.seniorDeduction, SOURCES.brackets2026],
  },
];

export default function LearnPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div>
      <PageTitle title="How the rules work" subtitle="Plain-English explanations behind every recommendation — with sources." />

      <div className="space-y-2">
        {TOPICS.map((t, i) => {
          const isOpen = open === i;
          return (
            <Card as="div" key={i} className="overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : i)} className="press flex w-full items-center justify-between text-left">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="text-lg">{t.icon}</span> {t.title}
                </span>
                <span className={`text-foreground/40 transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
              </button>
              {isOpen && (
                <div className="rise mt-3 space-y-2 border-t border-border pt-3">
                  {t.body.map((p, j) => (
                    <p key={j} className="text-[13px] leading-relaxed text-foreground/75">
                      {p}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                    {t.sources.map((s, j) => (
                      <a
                        key={j}
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
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}
