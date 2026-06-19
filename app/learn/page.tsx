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

/** A model/method behind the forecast, explained for both a retiree and a CFA:
 *  how it works, why it's used, and who in the industry uses it (with sources). */
interface Method {
  icon: string;
  name: string;
  /** Plain-English "how it works" — grounded in how this app uses it. */
  how: string;
  /** Why the method is used (what problem it solves). */
  why: string;
  /** Who uses it in practice + whether it's industry-standard or emerging. */
  who: string;
  sources: Source[];
}

// Drafted and fact-checked (sources web-verified, attribution and "how" checked
// against the real implementation) by the methods-education-content workflow.
const METHODS: Method[] = [
  {
    icon: "📈",
    name: "Forward capital-market assumptions",
    how: `Instead of assuming your savings grow at the roughly 10% a year stocks averaged in the past, this app starts from “forward” estimates of what stocks, bonds, and cash are likely to earn over the next 10–15 years given today's prices: about 7.9% a year for stocks, 4.9% for bonds, and 3.1% for cash (J.P. Morgan's 2026 figures, cross-checked against Vanguard and Morningstar). The app sorts each of your actual holdings into stocks, bonds, or cash, blends those rates by how much you own of each, and uses the result both for a single “expected return” and for the thousands of what-if market simulations. It also assumes stocks and bonds can fall together in a bad year (a +0.16 correlation), as they did in 2022.`,
    why: `Stock prices are high relative to earnings today, so most professional forecasters expect lower returns ahead than long-run history suggests; planning on the old 10% would likely overstate how much you can safely spend. Using honest forward estimates gives you a more realistic, and slightly cautious, picture of whether your money lasts.`,
    who: `Forward capital-market assumptions are an industry standard for serious retirement and institutional planning: J.P. Morgan, Vanguard (its VCMM model), BlackRock, and Morningstar all publish them, and the CFA Institute teaches the method to charterholders as “capital market expectations.” Morningstar's retirement researchers (including David Blanchett, now at PGIM) use forward returns to set a safe withdrawal rate that has run well below the old 4% rule — dipping to 3.3% in 2021 and landing near 3.9% for 2026. This app's use of J.P. Morgan's published figures mirrors what a careful advisor or CFA would do.`,
    sources: [
      { label: "J.P. Morgan 2026 Long-Term Capital Market Assumptions", url: "https://am.jpmorgan.com/us/en/asset-management/adv/insights/portfolio-insights/ltcma/" },
      { label: "CFA Institute — Capital Market Expectations: Forecasting Asset-Class Returns", url: "https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/capital-market-expectations-part-ii" },
      { label: "Vanguard Capital Markets Model (VCMM) return forecasts", url: "https://corporate.vanguard.com/content/corporatesite/us/en/corp/vemo/vemo-return-forecasts.html" },
      { label: "Morningstar — What's a Safe Retirement Withdrawal Rate for 2026?", url: "https://www.morningstar.com/retirement/whats-safe-retirement-withdrawal-rate-2026" },
    ],
  },
  {
    icon: "🎲",
    name: "Monte Carlo simulation",
    how: `This app plays out your whole retirement 1,000 times, and in each run it “rolls the dice” on the markets every single year instead of assuming one steady average return. It doesn't pick returns out of thin air: stocks, bonds, cash, and inflation move together the way they really do (so a 2022-style year where stocks AND bonds fall while inflation spikes can actually happen), and it deliberately allows more big crashes and booms than a simple bell curve would (“fat tails”). It then reports the share of those 1,000 runs where your money lasted to the end — your “probability of success,” shown as an honest range like “90% (88–92%)” rather than a single falsely precise number — plus how deep the shortfalls were in the bad runs.`,
    why: `A single “average return” hides the real danger: a few bad years early in retirement, while you're withdrawing, can sink a plan even if the long-run average looks fine. Running 1,000 varied futures shows you the odds and the range of outcomes, not one tidy guess.`,
    who: `Monte Carlo is the most common method in retirement planning, built into the major tools advisors use (eMoney, MoneyGuidePro, RightCapital) and run by firms like T. Rowe Price and Morningstar (whose retirement-research head, David Blanchett, CFA, publishes on it). “Probability of success” is the usual headline number, though it is actively debated: Blanchett and others argue it ignores how badly a plan falls short — which is why this app also reports failure depth.`,
    sources: [
      { label: "T. Rowe Price — How a Monte Carlo analysis could help your retirement plan", url: "https://www.troweprice.com/personal-investing/resources/insights/how-monte-carlo-analysis-could-improve-your-retirement-plan.html" },
      { label: "CFA Institute (David Blanchett, CFA) — Rethinking Retirement Planning Outcome Metrics", url: "https://rpc.cfainstitute.org/blogs/enterprising-investor/2023/rethinking-outcome-metrics-for-financial-planning" },
      { label: "Kitces.com — Probability-of-Success-Driven Guardrails", url: "https://www.kitces.com/blog/probability-of-success-driven-guardrails-advantages-monte-carlo-simulations-analysis-communication/" },
      { label: "eMoney Advisor — Monte Carlo Simulations for Retirement Planning", url: "https://emoneyadvisor.com/blog/monte-carlo-simulations-for-retirement-sparking-conversations-that-matter/" },
    ],
  },
  {
    icon: "🐡",
    name: "Fat tails & correlated assets (Student-t + Cholesky)",
    how: `Instead of assuming your investments earn a smooth average each year, the app rolls the dice 1,000 times to see how your money holds up. First, “fat tails”: rather than a tidy bell curve, each year's market shock is drawn from a Student-t distribution (set to about 6 “degrees of freedom”), which makes big crashes and big booms happen far more often than a bell curve allows. Second, “correlated assets”: stocks, bonds, cash, and inflation are drawn together using a correlation matrix and a math step called Cholesky decomposition, so a nasty year where stocks AND bonds fall while inflation spikes (like 2022) can actually show up. Each year the same fat-tail “amplifier” is shared across all the asset classes, so when one tail disaster hits, it tends to hit everything at once — the way real crises do.`,
    why: `Ordinary bell-curve models quietly underestimate disasters, treating a 1987- or 2022-style event as nearly impossible, and they wrongly assume bonds always cushion a stock drop. Modeling fat tails and linked assets gives you an honest picture of the bad years that matter most when you are drawing down savings.`,
    who: `Cholesky-correlated draws and Student-t fat tails are well-established quantitative techniques: they are taught in the CFA Institute curriculum and used in bank risk models (such as Value-at-Risk). Among consumer retirement calculators this is more rigorous than the norm, since many mass-market tools still rely on plain bell curves or fixed historical scenarios. Worth noting honestly: experts disagree on how much fat tails change retirement results, so treat it as a thoughtful refinement, not a settled standard.`,
    sources: [
      { label: "CFA Institute — Backtesting and Simulation (notes fat tails; multivariate skewed-t)", url: "https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/backtesting-and-simulation" },
      { label: "Burgess (2022) — Correlated Monte Carlo Simulation using Cholesky Decomposition (SSRN)", url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4066115" },
      { label: "Callan — Stock and Bond Declines at the Same Time in 2022", url: "https://www.callan.com/blog/stock-and-bond-declines/" },
      { label: "IMF — Stock-Bond Diversification Offers Less Protection From Selloffs", url: "https://www.imf.org/en/blogs/articles/2026/02/18/stock-bond-diversification-offers-less-protection-from-market-selloffs" },
    ],
  },
  {
    icon: "🔀",
    name: "Regime-switching returns (Hardy RSLN-2)",
    how: `This app runs a separate “what-if” simulation where the stock market flips between two moods: a calm, mostly-rising state and an occasional bad-news state with a negative average year. Each simulated year it draws a return based on the current mood, then decides whether next year stays put or switches — and because a bad year is more likely to be followed by another bad one (clustering), it produces deeper, more realistic crashes than a model that treats every year as independent. Importantly, the app re-tunes the two moods so this simulation's long-run average return and overall ups-and-downs exactly match its main forecast; the only thing that changes is the SHAPE — losses bunching together. It then runs your plan 1,000 times through this rougher market and reports how often the money lasts. It's flagged as an educational cross-check, since the bad-mood pattern is pieced together from only about 11 of 97 historical years (S&P 500, 1928–2024), so its numbers carry wide error bars.`,
    why: `A retirement is most vulnerable to a run of bad years bunched early on, and ordinary simulations that scatter good and bad years independently tend to understate that danger. This model deliberately makes downturns cluster, giving you a tougher, more honest stress test of whether your savings survive a rough patch.`,
    who: `This is a recognized actuarial approach. The two-state regime-switching lognormal model (RSLN-2) comes from Professor Mary Hardy (University of Waterloo), and it is one of the equity models U.S. actuaries are explicitly allowed to use to meet the official capital-setting rules for variable-annuity guarantees (the American Academy of Actuaries' C3 Phase II / AG 43 calibration criteria — though the regulators' own benchmark scenarios use a related “stochastic volatility” model, not RSLN itself). It builds on economist James Hamilton's widely used Markov-switching method for modeling business cycles.`,
    sources: [
      { label: "Hardy (2001) — A Regime-Switching Model of Long-Term Stock Returns, North American Actuarial Journal", url: "https://www.tandfonline.com/doi/abs/10.1080/10920277.2001.10595984" },
      { label: "American Academy of Actuaries — C3 Phase II Risk-Based Capital for Variable Annuities (2005)", url: "https://www.actuary.org/wp-content/uploads/2024/10/c3supp_march05.pdf" },
      { label: "American Academy of Actuaries — Equity Return Calibration Criteria (2013)", url: "https://www.actuary.org/sites/default/files/files/VAREQ_Equity_Calibration_Criteria_Analysis_6-4-13.pdf" },
      { label: "Hamilton — Regime-Switching Models (the Markov-switching foundation)", url: "https://econweb.ucsd.edu/~jhamilto/palgrav1.pdf" },
    ],
  },
  {
    icon: "🕰️",
    name: "Historical block bootstrap",
    how: `This is the app's “second-opinion” engine. Instead of inventing returns from a formula, it grabs random stretches of REAL U.S. market history (1928–2024) and stitches them together to build each what-if lifetime. Crucially, it copies 8 consecutive years at a time — a “block” — rather than single scrambled years, so the actual run-of-play is preserved: the way a bad 1973–74 tends to be followed by a recovery, or how a rough start (like the 1966 stagflation retiree) can dig a hole that haunts a plan for decades. To stay a fair comparison to the main forecast, every historical return is nudged up or down by a fixed amount so the long-run average matches today's 2026 outlook, while history's real ups, downs, and rare shocks stay intact. The app runs 1,000 of these stitched lifetimes and reports how often your money lasts.`,
    why: `It tests your plan against history roughly as it unfolded — including the gut-punch combinations of bad stocks, bad bonds, and high inflation happening together (like 2022) — rather than treating each year as independent. Keeping years in their real order is what captures “sequence risk”: the danger that a market slump in your first retirement years does far more damage than the same slump later.`,
    who: `Running a plan through actual market history is a common “second opinion” in popular retirement tools like FIRECalc, cFIREsim, and FI Calc. This app goes one step further by reshuffling history in 8-year blocks — a technique known in statistics as the “circular block bootstrap,” related to Politis and Romano's well-cited bootstrap work; it's a recognized academic method but less common in consumer calculators than plain historical replay. The underlying return data is the widely cited dataset from Professor Aswath Damodaran at NYU Stern.`,
    sources: [
      { label: "Aswath Damodaran (NYU Stern) — Historical Returns on Stocks, Bonds and Bills 1928–2024", url: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html" },
      { label: "Politis & Romano (1994) — The Stationary Bootstrap, JASA", url: "https://www.tandfonline.com/doi/abs/10.1080/01621459.1994.10476870" },
      { label: "Kitces.com — Understanding Sequence of Return Risk & Safe Withdrawal Rates", url: "https://www.kitces.com/blog/understanding-sequence-of-return-risk-safe-withdrawal-rates-bear-market-crashes-and-bad-decades/" },
      { label: "FI Calc — historical-simulation retirement calculator", url: "https://ficalc.app/" },
    ],
  },
  {
    icon: "🛟",
    name: "Dynamic spending guardrails (Guyton-Klinger)",
    how: `Instead of giving yourself the same paycheck every year (just bumped for inflation), this setting lets your spending breathe with your portfolio. Each year the app compares your current withdrawal rate (this year's spending divided by your portfolio) to the rate you started with, then applies three rules. After a down-market year it skips that year's inflation raise, but only if your withdrawal rate has already crept above your starting rate (the “freeze”). It trims spending 10% if your rate has drifted more than 20% above where you started (the “cut”), and gives you a 10% raise if the rate falls more than 20% below your starting point (the “raise”). To avoid pointless belt-tightening near the end, the app switches off the cut rule once you have about 15 years or fewer left.`,
    why: `Being willing to flex your spending a little — trimming in bad years and enjoying more in good ones — lets your money last longer than rigidly spending the same inflation-adjusted amount no matter what. It materially raises the odds you don't run out.`,
    who: `This is a well-known, widely taught approach named after planner Jonathan Guyton and William Klinger, who published it in the March 2006 Journal of Financial Planning. It's offered as a dynamic-spending option in advisor software such as RightCapital, and the broader “flexible spending” idea is studied by Morningstar's retirement researchers. It's popular but not the only flavor: planner Michael Kitces argues newer “risk-based” guardrails (built into tools like Income Lab) can soften the deepest spending cuts.`,
    sources: [
      { label: "Guyton & Klinger (2006) — Decision Rules and Maximum Initial Withdrawal Rates, Journal of Financial Planning", url: "https://www.financialplanningassociation.org/sites/default/files/2021-11/2006%20-%20Guyton%20and%20Klinger%20-%20Decision%20Rules%20and%20SWR%20(1).PDF" },
      { label: "Kitces.com — Why Guyton-Klinger Guardrails Can Be Too Risky (and risk-based guardrails)", url: "https://www.kitces.com/blog/guyton-klinger-guardrails-retirement-income-rules-risk-based/" },
      { label: "Morningstar (Christine Benz) — When It Comes to Retirement Spending, Flexibility Pays", url: "https://www.morningstar.com/retirement/when-it-comes-retirement-spending-flexibility-pays" },
    ],
  },
  {
    icon: "💧",
    name: "Safe / sustainable withdrawal rate",
    how: `A “safe withdrawal rate” answers a simple question: how much can you pull from your savings each year and still have a strong chance of never running out? This app skips the old rule-of-thumb and instead runs a Monte Carlo simulation (many pretend market futures, about 120 per test by default), then homes in on the spending level that hits a chosen success rate using a fast narrowing-in search called bisection. It reports two numbers: a cautious “plan-with” amount (about a 90% chance of lasting) and a “best-guess” amount (about 50%, the middle of the road).`,
    why: `Spending too much risks outliving your money; spending too little means an unnecessarily thin retirement you can't get back. Showing both a careful figure and a realistic middle estimate gives you a concrete dollar amount to plan around instead of a vague guess.`,
    who: `The 90% “plan-with” figure is common practice: the leading advisor platforms MoneyGuidePro and eMoney both center on a “probability of success” score, and Morningstar's annual research targets 90% success over a 30-year retirement. The 50% “best-guess” view is a newer, still-debated idea argued by planner Michael Kitces; many advisors still treat odds below 70% as worrying, and Kitces ties a 50% target to adjusting your spending over time — which this app does not assume in the safe-spending solver.`,
    sources: [
      { label: "Bengen (1994) — Determining Withdrawal Rates Using Historical Data (the 4% rule)", url: "https://en.wikipedia.org/wiki/William_Bengen" },
      { label: "Cooley, Hubbard & Walz (1998) — the “Trinity Study”, AAII Journal", url: "https://www.aaii.com/journal/199802/feature.pdf" },
      { label: "Morningstar — What's a Safe Retirement Withdrawal Rate? (90% success over 30 years)", url: "https://www.morningstar.com/retirement/whats-safe-retirement-withdrawal-rate-2026" },
      { label: "Kitces.com — A Monte Carlo 50% Success Probability Can Work", url: "https://www.kitces.com/blog/monte-carlo-retirement-projection-probability-success-adjustment-minimum-odds/" },
    ],
  },
  {
    icon: "⏳",
    name: "Longevity modeling (Gompertz mortality)",
    how: `The app uses a Gompertz mortality curve — a long-established formula showing that the chance of dying rises steadily with age — to estimate the odds you (and a spouse) are still alive at every future age, instead of just assuming everyone lives to a fixed “plan to 95.” Its two dials, m (the most likely age at death) and b (how spread out deaths are), were fit ahead of time to the Social Security Administration's 2021 life table. For a couple it computes “last survivor” odds — the chance at least one of you is still alive — because the money has to last until both have passed. It then suggests a defensible planning age: the age at which the last survivor has only a 10% chance of still being alive.`,
    why: `Outliving your savings is the central risk in retirement, and a single guessed age either wastes money by being too cautious or runs you dry by being too optimistic. Modeling the full probability of reaching each age — especially the “at least one of us survives” odds for couples — sizes the plan to a realistic, defensible horizon instead of a round number.`,
    who: `Planning around survival probabilities (rather than a single round age) is widely recommended in the profession — championed by Morningstar's David Blanchett and the planning research site Kitces.com. The specific Gompertz formula this app uses is a well-established method tied to finance professor Moshe Milevsky; it's common in research and some tools, though many planners instead use raw life tables or Monte Carlo software. The free Actuaries Longevity Illustrator — from the Society of Actuaries and the American Academy of Actuaries — does something very similar for consumers.`,
    sources: [
      { label: "Milevsky (2020) — Calibrating Gompertz in reverse (Insurance: Mathematics and Economics)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7339829/" },
      { label: "SSA — Actuarial Life Table (death probabilities & life expectancy by age and sex)", url: "https://www.ssa.gov/oact/STATS/table4c6.html" },
      { label: "Kitces.com — Life Expectancy Assumptions: Singles, Couples, and Survivors", url: "https://www.kitces.com/blog/life-expectancy-assumptions-in-retirement-plans-singles-couples-and-survivors/" },
      { label: "Actuaries Longevity Illustrator (Society of Actuaries & American Academy of Actuaries)", url: "https://www.longevityillustrator.org/" },
    ],
  },
  {
    icon: "📉",
    name: "Tail-risk metrics (CVaR / Expected Shortfall)",
    how: `After running 1,000 simulated lifetimes of your plan, the app lines up every run's ending nest egg from worst to best, takes the worst 10% of those outcomes, and averages them. That single average is the “tail-risk” number — also called CVaR or Expected Shortfall — in plain terms, “if things go badly, here's roughly how much you'd be left with on average.” It reports this both in future dollars and in today's dollars, so you can read it in money you understand.`,
    why: `A plan can look fine “on average” yet still hide ugly worst cases; this number answers “how bad is bad?” rather than just “how often do I fall short?” It focuses on the depth of the rough outcomes — exactly the scenarios a retiree most needs protection against.`,
    who: `This is a well-established, industry-standard risk measure. Global bank regulators (the Basel Committee's FRTB rules) now require Expected Shortfall at the 97.5% level instead of plain Value-at-Risk for market-risk capital, and the CFA Institute's research describes it as a “coherent” risk measure that fixes VaR's blind spot in the tail. In retirement work it's less universal: researchers like Morningstar's David Blanchett have pushed the field beyond simple pass/fail success rates toward measuring how deep shortfalls go — the same idea this metric captures.`,
    sources: [
      { label: "Rockafellar & Uryasev (2000) — Optimization of Conditional Value-at-Risk, Journal of Risk", url: "https://sites.math.washington.edu/~rtr/papers/rtr179-CVaR1.pdf" },
      { label: "Artzner, Delbaen, Eber & Heath (1999) — Coherent Measures of Risk", url: "https://onlinelibrary.wiley.com/doi/10.1111/1467-9965.00068" },
      { label: "Basel Committee (2019) — Minimum capital requirements for market risk (FRTB, 97.5% ES)", url: "https://www.bis.org/bcbs/publ/d457_note.pdf" },
      { label: "CFA Institute Research Foundation — Risk Management: A Review (VaR, ES, CVaR)", url: "https://www.cfainstitute.org/sites/default/files/-/media/documents/book/rf-lit-review/2009/rflr-v4-n1-1-pdf.pdf" },
    ],
  },
  {
    icon: "🔥",
    name: "Stochastic inflation (AR-1)",
    how: `Instead of assuming inflation sits at one fixed number forever, this app lets it drift and wander year to year, the way real inflation does. It uses an AR(1) process (“autoregressive” — a fancy term for “this year's inflation remembers last year's”). Each simulated year, inflation pulls back toward the rate you assumed but carries about 60% of last year's gap forward, then gets a random nudge — so a high-inflation year tends to be followed by another high one, and the figure is kept inside a sane band (−2% to +12%). Crucially, that nudge is tied to bond returns: inflation is given a negative correlation with bonds, so a year when inflation spikes tends to be a year when bonds fall — recreating a 2022-style stretch where stocks and bonds dropped together, the single biggest threat to someone just entering retirement.`,
    why: `Inflation is the quiet force that decides whether your money still buys groceries in 20 years, and it tends to come in sticky stretches, not one-off blips. Modeling it as a persistent, wandering series — rather than a flat guess — gives an honest picture of the years when rising prices and falling bonds gang up at the worst possible time.`,
    who: `Modeling inflation as a mean-reverting AR(1) series is the standard approach in actuarial economic scenario generators — the Wilkie-style models documented in the joint Casualty Actuarial Society / Society of Actuaries framework by Ahlgrim, D'Arcy and Gorvett do exactly this. It's still uncommon in everyday consumer retirement calculators, which usually draw each year's inflation independently; retirement researcher David Blanchett (PGIM, formerly Morningstar) and co-authors have used autoregressive models for precisely this reason. So this app's method is best described as research- and actuarial-grade, not a consumer-tool norm.`,
    sources: [
      { label: "Ahlgrim, D'Arcy & Gorvett — Modeling Financial Scenarios (Casualty Actuarial Society / SOA)", url: "https://www.casact.org/abstract/modeling-financial-scenarios-framework-actuarial-profession" },
      { label: "Blanchett, Finke & Pfau (2013) — Low Bond Yields and Safe Portfolio Withdrawal Rates (SSRN)", url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2286146" },
      { label: "Actuarial Standard of Practice No. 27 — Selection of Economic Assumptions", url: "http://www.actuarialstandardsboard.org/asops/selection-of-economic-assumptions-for-measuring-pension-obligations-effective-august-1-2021/" },
      { label: "J.P. Morgan Private Bank (2025) — how 2022 broke the usual stock-bond relationship", url: "https://privatebank.jpmorgan.com/nam/en/insights/markets-and-investing/tmt/beyond-bonds-how-to-protect-against-inflation-led-shocks" },
    ],
  },
  {
    icon: "🧮",
    name: "Geometric vs. arithmetic returns (volatility drag)",
    how: `Your money's “average” return can be told two ways, and this app uses both on purpose. The arithmetic average is the simple year-to-year average (the app's “expected” return — for example, the 7.94% it assumes for U.S. stocks); the geometric average is the rate your balance actually compounds at after good and bad years partly cancel out, and it's always lower. The app gets the compound rate by subtracting “volatility drag” — roughly half the variance — from the arithmetic average. It uses the higher arithmetic mean in the random year-by-year Monte-Carlo simulation (the correct single-year expectation) but compounds the lower geometric rate as the steady “Moderate” straight-line scenario, so it never overstates your likely ending balance.`,
    why: `Using the simple average to project decades of compounding quietly inflates the forecast, because a 20% loss needs a 25% gain just to break even — losses hurt more than equal gains help. Splitting the two keeps the app honest: optimistic where randomness belongs, conservative where compounding does.`,
    who: `This split is a long-established, mainstream practice. The CFA Institute curriculum teaches the geometric mean as the right measure of multi-year compounded growth, and the “subtract about half the variance” shortcut is the same one used by planner-educator Michael Kitces and the Bogleheads investing community. Professional forecasters report it too: J.P. Morgan's Long-Term Capital Market Assumptions — the source this app's stock and bond figures come from — publish both arithmetic and compound (geometric) returns.`,
    sources: [
      { label: "Jacquier, Kane & Marcus (2003) — Geometric or Arithmetic Mean: A Reconsideration (CFA Institute)", url: "https://rpc.cfainstitute.org/research/financial-analysts-journal/2003/geometric-or-arithmetic-mean-a-reconsideration" },
      { label: "Kitces.com — Volatility Drag: How Variance Drains Investment Returns", url: "https://www.kitces.com/blog/volatility-drag-variance-drain-mean-arithmetic-vs-geometric-average-investment-returns/" },
      { label: "Bogleheads Wiki — Variance drain", url: "https://www.bogleheads.org/wiki/Variance_drain" },
    ],
  },
];

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
      "From age 70½ you can send money directly from a Traditional IRA to charity — a Qualified Charitable Distribution. Up to a per-person limit (about $111,000 in 2026, indexed), it's excluded from your income entirely.",
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
      "To project decades realistically, the tool moves things forward in nominal dollars and keeps them consistent: your spending rises with inflation, Social Security gets a matching cost-of-living adjustment, and the federal tax brackets, standard deduction, and Medicare (IRMAA) tiers are inflation-indexed each year — so your income and the brackets rise together instead of you silently drifting into higher brackets ('bracket creep'). A few thresholds are deliberately frozen because the law freezes them: the Social Security taxability thresholds ($32k/$44k) and the 3.8% NIIT threshold ($250k) aren't indexed, so over time more income crosses them — exactly as in real life.",
      "It also models the annual 'tax drag' on a taxable brokerage: as that account grows, it throws off proportionally more taxable dividends each year, which is a real cost that tax-free Roth (and tax-deferred pre-tax) accounts avoid — a key reason conversions help.",
      "It DOES model the 'widow's penalty' (on by default): when the older spouse passes — at an age you can set — the survivor files Single, with roughly half the brackets and deductions and keeping only the larger of the two Social Security checks. That's exactly why converting while both spouses are alive, in the wide joint brackets, is so valuable. It also reflects the 2-year Medicare (IRMAA) lookback — a conversion or RMD spike raises your premiums two years later, not the same year — and it applies the step-up in basis at death, so a taxable brokerage left to heirs passes income-tax-free.",
      "Market risk is handled in two layers: the year-by-year plan uses one steady (geometric/compound) return for clarity, and the separate Monte-Carlo confidence check runs 1,000 randomized-return simulations to show sequence-of-returns risk and the range of outcomes (see the methodology topic below for exactly how). A few things are deliberate simplifications — treat them as judgment calls: state tax is Illinois only; pre-65 ACA premium subsidies aren't modeled; any after-tax (nondeductible) IRA basis is ignored, so every conversion is treated as fully taxable (the IRS pro-rata rule); and inherited pre-tax is valued as drained over an heir's 10-year window at an assumed heir bracket (24% by default, adjustable on the Forecast tab). You can switch the whole forecast to today's dollars, choose Guyton-Klinger dynamic spending, and run stress tests there too. Everything here is an educational estimate — confirm with a tax professional before acting.",
    ],
    sources: [SOURCES.brackets2026, SOURCES.ssSurvivor, SOURCES.rothConversion],
  },
  {
    icon: "🎲",
    title: "How the forecast & Monte Carlo work (methodology)",
    body: [
      "Returns come from forward-looking 2026 capital-market assumptions (J.P. Morgan's Long-Term assumptions, cross-checked vs. Vanguard and Morningstar), blended by your actual stock/bond/cash mix — not a backward-looking ~10% stock average, which is optimistic at today's valuations. Per class (arithmetic nominal): US stocks ~7.9% with ~16.5% volatility, US bonds ~4.9%, cash ~3.1%. The single-line forecast compounds the GEOMETRIC return (the arithmetic average minus ½×volatility²) — compounding the higher average would overstate your balance, a classic mistake.",
      "The Monte Carlo runs your full plan 1,000 times. Each year, stocks, bonds, and cash are drawn TOGETHER from a correlation matrix (Cholesky decomposition) using the modern, slightly POSITIVE stock-bond correlation — so a 2022-style year where both fall at once can actually happen. The shocks are a multivariate Student-t (fat tails), so crashes and booms occur far more often than a normal bell curve allows, and tail events hit all assets at once. Withdrawals come out before each year grows, so sequence-of-returns risk (a bad early decade) emerges naturally.",
      "Outcomes are reported as PERCENTILES, not 'average ± standard deviation,' because ending wealth is heavily right-skewed (a few great runs pull the average up). The 50th percentile is the median; the 25th–75th is the likely range; the 10th–90th brackets unlucky-to-lucky. The headline 'X% confidence' is the share of runs that funded full spending to your plan age — shown with a 95% Wilson confidence interval (e.g. '90% (88–92%)') so you don't over-read a number that's really ±a few points of simulation noise. We also report the worst-10% (CVaR) ending wealth and, if you fall short, the typical age it happens — because a bare success/fail percentage hides how bad the bad cases are.",
      "Two advisor-grade options live on the Forecast tab. GUARDRAILS (Guyton-Klinger) models a flexible retiree who trims spending ~10% after the portfolio falls too far and raises it after good years — which dramatically improves survivability, so we show how deep the spending cuts get alongside the success rate. STRESS TESTS run your exact plan through fixed worst-case sequences (a crash at retirement, two bad years, retiring into 2008, the 2000s 'lost decade' with real S&P returns) to isolate timing risk. Inflation is also modeled as RANDOM, not a fixed rate — a mean-reverting (AR-1) process correlated with bonds, so a 1970s-style inflation shock can erode real spending in the same runs where it hurts most.",
      "Because no single return model is the whole truth, the Forecast tab also lets you re-run your exact plan through two independent SECOND OPINIONS. The historical BLOCK-BOOTSTRAP draws multi-year blocks of actual 1928–2024 market history (like cFIREsim), capturing real crashes and the way stocks, bonds, and inflation truly moved together. The REGIME-SWITCHING engine (Hardy's RSLN-2, the model actuaries use for capital reserving) flips between a calm bull market and a sharply negative bear market where a down year is much more likely to be followed by another — so bad years cluster, rather than being spread out as an i.i.d. model assumes. The two cross-check engines are detrended to the main model's long-run averages (and the regime engine is also scaled to the same volatility, so its only difference is the clustering), so when all three land in the same neighborhood — they typically do, within a few points — your result is robust to how returns are modeled, not an artifact of one model's shape. (We validate this offline too: four independent return engines — normal, fat-tailed Student-t, regime-switching, and historical bootstrap — run through a common withdrawal model agree on the success rate to within ~5 points, with a fifth no-volatility path as a deterministic sanity anchor.)",
      "Longevity is modeled, not guessed. The 'How long should you plan for?' card fits a Gompertz survival curve to the official SSA period life table and, for a couple, computes the odds that at LEAST ONE of you is still alive at each age — then suggests a plan-to age that covers all but the longest ~10% longevity tail. Planning only to life expectancy is roughly a coin-flip of outliving the money, which is why we steer toward a tail age. Limitations we're still honest about: returns ignore valuation (CAPE) starting points, and the survival model treats the two lives as independent (no 'broken-heart' correlation).",
    ],
    sources: [SOURCES.brackets2026, SOURCES.capGains],
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
  const [openMethod, setOpenMethod] = useState<number | null>(null);
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

      {METHODS.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold">The models &amp; methods behind your forecast</h2>
          <p className="mb-3 mt-0.5 text-[13px] leading-relaxed text-foreground/60">
            The forecast and Monte Carlo lean on techniques from professional financial planning, investment risk, and
            actuarial science. Here&apos;s each one in plain English — what it does, why it&apos;s used, and who in the
            industry relies on it — with sources.
          </p>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {METHODS.map((m, i) => {
              const isOpen = openMethod === i;
              return (
                <Card as="div" key={i} className="overflow-hidden">
                  <button
                    onClick={() => setOpenMethod(isOpen ? null : i)}
                    className="press flex w-full items-center justify-between text-left"
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="text-lg">{m.icon}</span> {m.name}
                    </span>
                    <span className={`text-foreground/40 transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
                  </button>
                  {isOpen && (
                    <div className="rise mt-3 space-y-3 border-t border-border pt-3">
                      <MethodBlock label="How it works" text={m.how} />
                      <MethodBlock label="Why it's used" text={m.why} />
                      <MethodBlock label="Who uses it" text={m.who} />
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                        {m.sources.map((s, j) => (
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
        </div>
      )}

      <div className="mt-6">
        <Disclaimer />
      </div>
    </div>
  );
}

function MethodBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-primary/70">{label}</div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/75">{text}</p>
    </div>
  );
}
