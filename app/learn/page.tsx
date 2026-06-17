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
  {
    icon: "💣",
    title: "The RMD 'tax bomb' — and Roth conversions",
    body: [
      "A large pre-tax balance (Traditional IRA / 401k) is a tax bill waiting to happen. Starting at 73 or 75 the IRS forces Required Minimum Distributions, and because the divisor shrinks every year while the balance keeps growing, those forced withdrawals balloon — often pushing you into a higher bracket, taxing more of your Social Security, and tripping Medicare (IRMAA) surcharges, whether you need the money or not.",
      "The classic defense is a Roth conversion: in your low-income years (after work, before Social Security and RMDs), you deliberately move money from pre-tax to Roth and pay tax on it now, at today's low rate. That shrinks the future forced withdrawals, and the money then grows tax-free in the Roth with no RMDs ever.",
      "The trade-off: you pay tax sooner. It pays off if your rate later (or your heirs' rate) would be higher than your rate now — which is common for a pre-tax-heavy couple, and is even stronger once you factor in the survivor years (see the widow's-penalty topic). It's usually NOT worth converting so much that you jump a bracket or cross an IRMAA cliff.",
      "Even while you're spending from the brokerage, those same low-income early years are often the best time to convert — the two work together. Use the bracket-fill control on the Plan tab to fill a low bracket without overshooting.",
    ],
    sources: [SOURCES.rothConversion, SOURCES.rmd, SOURCES.brackets2026],
  },
  {
    icon: "🕊️",
    title: "The widow(er)'s penalty (why survivors pay more)",
    body: [
      "When one spouse dies, the survivor usually keeps only the LARGER of the two Social Security checks — the smaller one stops. But the next year they file as Single, with roughly half the standard deduction, narrower tax brackets, and Medicare (IRMAA) income thresholds cut about in half — all while the pre-tax balance and its RMDs roll on.",
      "So the same income that was comfortable as a couple can be taxed far harder for the survivor. This is one of the strongest reasons to do Roth conversions while both spouses are alive (wide joint brackets), and to delay the higher earner's Social Security so the survivor's lifelong check is as large as possible.",
    ],
    sources: [SOURCES.ssSurvivor, SOURCES.filingStatus],
  },
  {
    icon: "🚀",
    title: "The Social Security 'tax torpedo'",
    body: [
      "Because more of your Social Security becomes taxable as your other income rises, a single extra dollar of withdrawal can drag a dollar (or 85¢) of benefits into tax at the same time. In a band of income, that makes your TRUE marginal rate much higher than the bracket suggests — a 12% bracket can behave like ~22%, and 22% like ~40%.",
      "This is why pulling a big pre-tax withdrawal 'just into the 12% bracket' can quietly cost far more than 12%. The planner accounts for it; watch the effective vs. marginal rate, and consider tax-free Roth for the slice of spending that would otherwise sail through the torpedo.",
    ],
    sources: [SOURCES.ssTax],
  },
  {
    icon: "❤️",
    title: "QCDs — give to charity straight from your IRA",
    body: [
      "From age 70½ you can send money directly from a Traditional IRA to charity — a Qualified Charitable Distribution. Up to a per-person limit (about $108,000 in 2025, indexed), it's excluded from your income entirely.",
      "Because it never hits your AGI, a QCD is more powerful than donating cash and deducting it: it lowers the income that determines how much of your Social Security is taxed and which IRMAA tier you land in, and once you're taking RMDs the QCD counts toward satisfying them. If you're charitably inclined and have a big pre-tax balance, it's one of the cleanest tax moves available.",
    ],
    sources: [SOURCES.qcd, SOURCES.rmd],
  },
  {
    icon: "⏳",
    title: "Inherited IRAs & the 10-year rule",
    body: [
      "If you inherited an IRA from someone other than a spouse (a parent, say) after 2019, the SECURE Act generally requires the whole account to be emptied within 10 years. If the original owner had already started their RMDs, you also have to take a minimum each year in between.",
      "This matters for timing: those withdrawals stack on top of your own income, so it's often worth spreading them across the 10 years to fill low brackets rather than taking a big lump in one year. An inherited IRA is taxed on its own schedule — don't confuse it with your own IRA's RMD age.",
    ],
    sources: [SOURCES.inheritedIra],
  },
  {
    icon: "🏢",
    title: "Company stock in a 401(k) — the NUA move",
    body: [
      "If you hold a lot of appreciated EMPLOYER stock inside a 401(k), rolling it all to an IRA can be a mistake. A Net Unrealized Appreciation election lets you move the shares to a brokerage account, pay ordinary tax only on your original cost basis now, and have the entire gain taxed later at the lower long-term capital-gains rate (and it sidesteps RMDs on those shares).",
      "It's a one-time, rules-heavy decision worth running by a professional — but if you have low-basis company stock, ask specifically about NUA versus a plain rollover-and-convert.",
    ],
    sources: [SOURCES.nua, SOURCES.capGains],
  },
  {
    icon: "🏖️",
    title: "Does buying a second / summer home save on taxes?",
    body: [
      "Short version: for a home you use yourself (not rent out), the federal income-tax benefit is small — often zero. A personal second home generates NO depreciation (only rentals do); its mortgage interest and property tax are deductible only if you itemize, and most retirees come out ahead taking the big standard deduction, so those write-offs go unused; and the home-sale gain exclusion ($500k for a couple) applies only to your PRIMARY residence, not a vacation home. Buying a house mainly 'to save on taxes' as a personal residence is largely a myth.",
      "So why would an advisor suggest it? Usually one of three real angles — and it's worth asking which they meant: (1) STATE taxes — if the home is in a no-income-tax state (Florida, Texas, etc.) and you make it your legal primary residence, you can stop paying state income tax on your retirement income. For many retirees that's the biggest lever of all. (2) ESTATE — real estate gets a 'stepped-up' basis at death, so its appreciation can pass to heirs with the gain wiped out. (3) If you RENT it out, it becomes investment property: depreciation then shelters the rental income, and you can defer gains by exchanging into another property (a §1031 exchange).",
      "The catches: a personal home ties up a lot of cash in an illiquid, concentrated, hard-to-manage asset (you can't sell a bedroom to fund a year of spending), with ongoing costs — and you'd be spending real capital largely for a benefit that, for a personal home, mostly isn't there. Establishing a new state domicile also has real rules (days present, where you vote/license/bank).",
      "Does it fit YOUR plan? This tool models federal withdrawal tax, not real estate or state tax. If the goal is the lowest tax PERCENT and the most after-tax wealth, buy a second home because you want it — not for a federal tax break that, for personal use, is mostly a mirage. The genuine tax wins live in the state-residency and estate angles, or in actually renting it.",
    ],
    sources: [SOURCES.realEstate, SOURCES.stepUp],
  },
  {
    icon: "🏥",
    title: "Health coverage before 65 (ACA subsidies)",
    body: [
      "Retiring before 65 means buying health insurance on the ACA marketplace until Medicare starts. The subsidy (premium tax credit) is based on your income — so a big Roth conversion or IRA withdrawal in those years can cost you thousands in lost subsidy, sometimes a bigger hit than IRMAA later.",
      "If a spouse is under 65, weigh conversions against the subsidy you'd give up. This app models federal tax, not ACA subsidies, so keep this trade-off in mind for the pre-65 years.",
    ],
    sources: [SOURCES.aca],
  },
  {
    icon: "🟢",
    title: "Illinois state tax — why it loves retirees (and conversions)",
    body: [
      "Illinois has a flat 4.95% income tax, but it does NOT tax retirement income. Distributions from 401(k)s, 403(b)s, and IRAs (including your RMDs), pensions and government/military retirement, and Social Security are all subtracted on the Illinois return (IL-1040 Line 5). So at the state level, those are tax-free.",
      "The big one for planning: a Traditional-IRA-to-Roth CONVERSION is also subtracted — Illinois doesn't tax the conversion at all. You only pay FEDERAL tax to convert. That makes Roth conversions more attractive in Illinois than in most states, because the state takes nothing on the way over.",
      "What Illinois DOES tax (at the flat 4.95%, with no preferential capital-gains rate): your investment income — taxable interest, dividends, and capital gains in a brokerage account. So the state-tax lever here is mostly about your taxable brokerage, not your retirement accounts.",
      "One catch: a very large conversion can push your AGI over $500,000 (married filing jointly), which phases out the Illinois personal exemption (about $2,850 per person) — a small effect, but the planner accounts for it. Illinois figures are 2025 (verified against the IL Dept. of Revenue). This tool now models Illinois; more states are coming.",
    ],
    sources: [SOURCES.ilRetirement, SOURCES.ilRate, SOURCES.rothConversion],
  },
  {
    icon: "🔬",
    title: "What this planner models (and what it doesn't)",
    body: [
      "To project decades realistically, the tool moves things forward in nominal dollars and keeps them consistent: your spending rises with inflation, Social Security gets a matching cost-of-living adjustment, and the federal tax brackets, standard/senior deductions, and Medicare (IRMAA) tiers are inflation-indexed each year — so your income and the brackets rise together instead of you silently drifting into higher brackets ('bracket creep'). A few thresholds are deliberately frozen because the law freezes them: the Social Security taxability thresholds ($32k/$44k) and the 3.8% NIIT threshold ($250k) aren't indexed, so over time more income crosses them — exactly as in real life.",
      "It also models the annual 'tax drag' on a taxable brokerage: as that account grows, it throws off proportionally more taxable dividends each year, which is a real cost that tax-free Roth (and tax-deferred pre-tax) accounts avoid — a key reason conversions help.",
      "What it does NOT model yet, so treat these as judgment calls on top of the numbers: (1) The 'widow's penalty' — it assumes both spouses live to your plan age and file jointly the whole time. In reality the survivor eventually files Single, with roughly half the brackets and deductions, which makes conversions while both are alive even more valuable than shown. (2) Market risk — returns are a single steady rate, not a range, so it can't show sequence-of-returns risk (a bad early decade). (3) State tax is Illinois only for now, and ACA subsidies (pre-65) aren't modeled. Everything here is an educational estimate — confirm with a tax professional before acting.",
    ],
    sources: [SOURCES.brackets2026, SOURCES.ssSurvivor, SOURCES.rothConversion],
  },
  {
    icon: "📍",
    title: "Muni-bond interest & other states",
    body: [
      "Tax-exempt municipal bond interest isn't taxed federally — but it still counts toward the income that determines how much of your Social Security is taxed and which Medicare (IRMAA) tier you're in. 'Tax-free' isn't free of those effects, and the planner accounts for it (enter it on the Accounts tab).",
      "This tool currently models FEDERAL tax plus ILLINOIS state tax. Other states tax retirement income very differently — some (like Illinois) exempt it entirely, others tax it in full — and that can change which strategy wins. If you move or live elsewhere, treat the state piece as Illinois-specific until more states are added.",
    ],
    sources: [SOURCES.ssTax, SOURCES.irmaa],
  },
  {
    icon: "⚖️",
    title: "Sales pitches & myths — a neutral take",
    body: [
      "Not everything an advisor recommends is wrong — but some products are sold because they pay the advisor a commission, not because they're best for you. A few honest guidelines from a neutral corner:",
      "How your advisor is paid matters most. A fee-only fiduciary (paid a flat or hourly fee and legally required to act in your interest) has far fewer conflicts than someone earning commissions on what they sell. Fair question to ask anyone: 'Are you a fiduciary, and exactly how are you paid?'",
      "Fees compound against you. A 1%/yr advisory fee on top of a 0.7% fund can quietly eat a quarter to a third of your nest egg over a retirement. Low-cost index funds beat most actively managed funds, after fees, over time — 'we'll beat the market' is a sales story, not a plan.",
      "Complexity usually benefits the seller. Non-traded REITs, structured notes, and 'private' or 'exclusive' products tend to be illiquid and high-fee; the simple version — broad index funds plus a sensible, tax-smart withdrawal plan (what this tool does) — usually wins.",
      "Cash-value life insurance (whole life, indexed universal life) is often pitched as 'tax-free retirement income.' It can fit a specific estate or insurance NEED, but for most retirees the high costs and big commissions make it a poor substitute for maxing Roth/HSA and investing the difference. Be especially wary if you have no actual need for life insurance.",
      "Buying a second/summer home 'for the tax break' — see the card above; for a home you use yourself, that break mostly isn't real.",
      "None of this means avoid advisors — a good fee-only fiduciary is genuinely worth it. It means always understand WHY something is being recommended, and what it costs you versus the simple alternative.",
    ],
    sources: [SOURCES.fiduciary, SOURCES.fees],
  },
  {
    icon: "🛟",
    title: "Annuities — useful tool, or sales product?",
    body: [
      "Annuities are the most commission-heavy thing advisors sell, so they're worth understanding. The honest split:",
      "Can genuinely help: a plain immediate annuity (SPIA), or a deferred-income annuity / QLAC, turns a slice of savings into a guaranteed lifetime check — real 'longevity insurance' if you're worried about outliving your money or want a spending floor on top of Social Security. Low-cost and simple for the right person.",
      "Often oversold: variable and indexed annuities are complex, carry high annual fees and multi-year surrender charges, and pay large commissions. The 'tax-deferred growth' pitch rarely beats simply using your IRA/401(k)/Roth, and the headline 'guarantees' come with caps and costs that are easy to misunderstand.",
      "Questions to ask before buying any annuity: What's the all-in annual cost? How long is the surrender period? What commission is paid? Could a low-cost SPIA — or just my own portfolio with a smart withdrawal plan — do this more cheaply? This app already treats a pension/annuity as guaranteed income, so you can enter the income one would add and see how it changes the plan.",
    ],
    sources: [SOURCES.annuitiesSEC],
  },
];

export default function LearnPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div>
      <PageTitle title="How the rules work" subtitle="Plain-English explanations behind every recommendation — with sources." />

      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
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
