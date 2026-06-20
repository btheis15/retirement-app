# Retirement Tax Optimizer — Engineering, Design & Financial-Models Reference

> Educational estimates only — not tax, legal, or investment advice. Models 2026 federal tax and Illinois state tax. Auto-generated from the source by a multi-agent documentation pass, then human-reviewed.

## Table of Contents

- Overview & Design Philosophy
- Architecture
- The Tax Engine (2026, professional-grade)
- The Lifetime Projection
- The Optimizer, Recommender & the "Most Money" Probability Engine
- Monte Carlo & Capital-Market Assumptions
- The Start Walkthrough (13 steps)
- Verification & Quality Bar
- Developing, Running & Deploying

---

## Overview & Design Philosophy

### What this app is

The **Retirement Tax Optimizer** is a client-side retirement and tax-planning planner for someone at or near retirement. Given a spending target and a set of accounts — rollover 401(k)s, Traditional IRAs, Roth IRAs, a taxable brokerage, cash, and Social Security — it answers the central question a retiree faces every year: **which accounts do I withdraw from, in what order, to pay as little federal tax as possible?**

It is not a toy. It models the real, interacting federal rules that make that question hard — ordinary brackets, the up-to-85% taxability of Social Security, the 0%/15%/20% long-term capital-gains and qualified-dividend stack, Required Minimum Distributions (RMDs at age 73 or 75 under SECURE 2.0, pre-tax only), the Medicare **IRMAA** surcharge cliffs, and the Net Investment Income Tax — all on **2026** figures, with both **single** and married-filing-jointly tax tables supported (`FilingStatus = "mfj" | "single"` in [`lib/tax/constants.ts`](lib/tax/constants.ts)). The engine is split into a pure tax core ([`lib/tax/engine.ts`](lib/tax/engine.ts)), a withdrawal optimizer ([`lib/optimizer.ts`](lib/optimizer.ts)), a multi-year projection ([`lib/projection.ts`](lib/projection.ts)), a milestone detector, and an opportunity detector, with [`lib/tax/constants.ts`](lib/tax/constants.ts) as the single source of truth for the yearly numbers.

Scope is deliberately bounded: **federal tax plus Illinois state tax (other states not yet modeled), educational estimates only — not tax, legal, or investment advice.** That disclaimer is load-bearing, not boilerplate, and appears prominently in-product.

### Two audiences, at the same time

Every screen has to satisfy two readers who normally want opposite things:

- **A non-technical retiree**, who wants to know *what to do* — how much they can spend, what's already covered, where the rest comes from, and roughly what the tax bill is — without learning tax law.
- **A skeptical CFA**, who will not trust a recommendation unless they can see the bracket math, the SS-taxability calculation, the cap-gains stacking, the IRMAA tier, and the authoritative source behind every rule.

The design resolves this tension by **layering**, not by averaging. The retiree gets a calm, plain-English front; the CFA gets the full derivation one layer down. Neither audience is asked to wade through the other's view.

### The "CFA-bulletproof" accuracy bar

The governing quality bar is that **a CFA reviewing any number must be unable to find it wrong.** Accuracy beats speed and beats cleverness. Concretely this means:

- Tax rules are computed, not approximated — SS provisional-income taxability, the ordinary/cap-gains stack, NIIT, and the IRMAA *step function* (crossing a MAGI ceiling by $1 adds the full next-tier surcharge) are modeled as the real cliffs and stacks they are, not as smooth slopes.
- Every rule shown to the user is backed by a citation to the IRS / SSA / Medicare source via the citation registry ([`lib/sources.ts`](lib/sources.ts)), surfaced in **Learn** ([`/learn`](app/learn)).
- Strategy comparisons are apples-to-apples. The optimizer ranks against a fixed yardstick and is **step-up-robust** — the recommended plan is not allowed to rest on a single tax bet (e.g. the brokerage basis step-up at death is acknowledged rather than assumed away).
- Yearly constants live in exactly one file so the numbers can be re-verified and updated each tax year without hunting through the codebase.

### Walkthrough-first: one decision per slide

The primary surface is a **guided, step-by-step Start flow** ([`components/GuidedPlan.tsx`](components/GuidedPlan.tsx)), not the dense dashboard. It presents **one decision or insight at a time**, in plain English, with a gentle directional slide between steps and a progress bar. The narration follows the order a person actually reasons in:

> goal → how much to spend → what already covers it → where to pull the rest → the Roth rollover → the tax bill and exactly why → the next few years → how solid the plan is.

Each step is a self-contained `Step { key, eyebrow, render }`, pushed onto a `steps[]` array. Steps are **conditional**: the rollover-confirmation step only appears if there's a meaningful pre-tax share; the own-vs-example setup step only appears when needed. A persistent cash-flow strip keeps the chosen spending number and the funding breakdown visible on every later step so the user never loses the thread. The order is intentional — for example, **spending** is shown on its own step with the Roth rollover deliberately held back to the *next* step (`conversion: null` on the spend step), so the picture builds up additively and the user can see the effect of spending alone before the conversion's tax is layered on.

### Simple main UI, deep detail in expanders / Learn

The dense, all-the-numbers dashboard still exists — but it lives **below** the walkthrough ("show all the numbers"), and the deepest derivations live inside expanders and in the **Learn** route. The walkthrough is "the calm front door so nobody has to study the page." This is the core principle: **the main UI stays simple; depth is always available but never in the way.** A retiree can finish the flow seeing only decisions, numbers, and one visual per step; a CFA can open the expanders and read the bracket-by-bracket reasoning.

### The "no surprise decisions" rule

Every decision the user is actually allowed to make has a corresponding **Start step**. The walkthrough is the complete enumeration of the levers — spending, withdrawal strategy, Roth rollover/conversion amount, claim timing — so a user can never discover, deep in some settings panel, a consequential choice the guided flow never mentioned. Conversely, exploratory levers are kept from masquerading as commitments: in [`HouseholdProvider`](components/HouseholdProvider.tsx), dragging the spending dial on the built-in example is treated as a "what if I spent this much?" lever (`demoSpending`) that changes the example **in place** rather than silently forking the example into "your own data." Editing any real input does fork demo → own, but that is a deliberate, visible transition — not a surprise.

### Mobile vs. desktop content split

The app is **mobile-first** ([`app/layout.tsx`](app/layout.tsx): `max-w-md` on phone, widening to `max-w-4xl`/`xl:max-w-5xl` with an `lg:pl-56` sidebar offset on desktop; bottom `TabBar` on phone, sidebar on desktop). The split is not just layout — it's a **content** decision:

- **Mobile shows "what it is"** — the decisions, the numbers, and **one visual** per step. Enough to act.
- **Desktop adds the "why"** — the evidence, the bracket math, the explanatory prose. This extra reasoning is gated behind a `DesktopOnly` wrapper (imported from [`components/ui`](components/ui.tsx) and used throughout `GuidedPlan.tsx`), so the same step renders lean on a phone and fully-explained on a wide screen.

This is how both audiences are served from one codebase: the phone gives the retiree a clean answer; the desktop gives the CFA the full justification, without either having to toggle modes.

### No backend — everything is client-side

There is **no server**. The app is a static-export PWA (Next.js 16 App Router + React 19 + TypeScript, Tailwind v4, dependency-free SVG charts), deployed to Vercel; every route builds static. All state — the household, accounts/holdings, and planner settings — lives in the browser via the `HouseholdProvider` React context, persisted to **localStorage** under the `rto-*` keys (`rto-mode`, `rto-own-household`, `rto-settings`, `rto-demo-seed`). The store runs in one of two modes: a read-only built-in **~$5M example** (`demo`, deterministic per seed, re-rollable via `newExample`) and the user's **own** data. Nothing is uploaded; the only network calls send ticker *symbols* (never amounts) to refresh live prices and dividends, and those refreshes only ever touch the user's own holdings, never the static example. Backups are explicit file import/export (`loadOwn`). The privacy posture — your numbers never leave your device — is itself part of the design contract.

---

## Architecture

The app is a **pure client-side Next.js application** — there is no application database, no user accounts, and no server-side modeling. Everything you type stays in your browser (`localStorage`), and the entire financial engine runs as plain TypeScript on the device (main thread or a Web Worker). The only server code is a thin set of stateless route handlers that proxy public market data (ticker search and prices) so the browser isn't blocked by CORS — and these never see your balances or identity, only ticker symbols.

### Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js `^16.2.6`, App Router** | `app/` directory; deployed to Vercel as a *serverless* app (not a static export) because of the `/api/ticker/*` route handlers. |
| UI runtime | **React `^19`** | All pages are client components (`"use client"`). |
| Language | **TypeScript `^5.6`** (`tsc --noEmit` via `npm run typecheck`) | The engine in `lib/` is strict pure TS. |
| Styling | **Tailwind CSS `^4`** (`@tailwindcss/postcss`) | `app/globals.css`; teal theme (`#0d4f4a`), responsive `max-w-md` (phone) → `max-w-4xl/5xl` (desktop). |
| Persistence | **`localStorage` only** | No backend, no cookies, no analytics. Optional at-rest encryption via Web Crypto (`lib/crypto.ts`). |
| Heavy compute | **Web Worker** (`lib/mc.worker.ts`) | Monte-Carlo simulations run off the main thread with a synchronous fallback. |
| Delivery | Installable **PWA** | `manifest.webmanifest`; documents served `no-store` so a fresh deploy reaches installed app immediately (`next.config.ts`). |

`package.json` has only three runtime dependencies — `next`, `react`, `react-dom`. There is **no charting library, no state library, no HTTP client, no math library**: charts, the store, and all financial math are hand-written in `lib/`.

### Two layers: engine (`lib/`) vs. UI (`app/` + `components/`)

The codebase is deliberately split so the modeling can be read, audited, and unit-reasoned independently of the rendering:

- **`lib/` — the engine.** Pure TypeScript, no React, no DOM, no I/O (the only exceptions are `prices.ts`, which is the client-side fetch/cache layer, and `crypto.ts`, which uses Web Crypto). Inputs and outputs are plain structured-cloneable data, which is exactly why the same functions run unchanged inside the Web Worker. This is where every dollar is computed: the tax engine, the lifetime projection, the withdrawal optimizer, the Monte-Carlo engines, the goal-based advisor.
- **`app/` + `components/` — the UI.** App Router pages and React client components. State lives in two context providers wrapped around the whole app in `app/layout.tsx`: `HouseholdProvider` (the household + planner settings store) and `PricesProvider` (live price/dividend data). Pages read from these via `useStore()` and feed the data into the `lib/` engines.

#### The client store (`components/HouseholdProvider.tsx`)

The single source of truth for user data. It exposes a `useStore()` hook and persists to four `localStorage` keys: `rto-mode`, `rto-own-household`, `rto-settings`, `rto-demo-seed`. Key design points:

- **Two modes.** `"demo"` shows a built-in example (the classic fixed ~$5M "Robert & Linda" household from `lib/demo.ts`, or a re-rollable randomized one keyed by `demoSeed`); `"own"` shows the user's real numbers. Hydration happens in a post-mount `useEffect` to avoid SSR mismatch (`ready` gates first paint).
- **The demo is read-only.** Editing while in demo mode silently forks into `"own"` mode (`editApply`) so the example stays pristine — *except* dragging the spending dial alone, which is treated as an exploratory "what if" lever and mutates the example in place via `demoSpending` (no fork).
- **Stable `household` reference.** The current household is `useMemo`'d so the heavy engines (Monte Carlo, projections) don't needlessly rerun on every settings change.
- **Privacy-preserving live data.** `applyLivePrices` / `applyLiveDividends` re-value holdings from market feeds but no-op in demo mode and skip user-hand-edited (`dividendManual`) holdings; only symbols were ever sent to fetch them.

### The Monte-Carlo Web Worker

Monte-Carlo runs (thousands of full lifetime projections) take ~1–4s and would freeze the UI on a phone. They are pushed off the main thread:

- **`lib/mc.worker.ts`** — the worker. Receives `{ id, kind, household, assumptions, model, runs, seed }`, dispatches by `kind` to the matching engine, and posts back `{ id, result }` or `{ id, error }`. Because the engines are pure TS with no DOM, they run here unchanged.
- **`lib/mcClient.ts`** — the main-thread client. Components call `computeMonteCarlo` / `computePaired` / `computeMostMoney` and get a `Promise`. A **single worker is reused** across calls, with each request matched to its response by an incrementing `id` held in a `pending` map.
- **Synchronous fallback.** If `Worker` is unavailable (SSR), construction throws, the worker crashes (`onerror` sets `workerBroken`), or `postMessage` throws on a non-cloneable input, `mcClient` transparently computes on the main thread (deferred one tick so a loading state can paint). Nothing breaks — it's just less smooth.

The five worker `kind`s map directly to engine entry points: `mc` → `runMonteCarlo`, `bootstrap` → `runHistoricalBootstrap`, `regime` → `runRegimeSwitching`, `paired` → `runPairedMonteCarlo`, `mostMoney` → `rankMostMoney`.

### Routes (App Router)

The app is a small set of pages plus the proxy API. A persistent `TabBar` (desktop sidebar / phone bottom bar) navigates between them.

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `app/page.tsx` | **Start** — the calm step-by-step `GuidedPlan` walkthrough ("What to do in {year}"); the front door for a first-time visitor. "See all the numbers" hands off to `/plan`. |
| `/accounts` | `app/accounts/page.tsx` | **Accounts** — enter accounts/holdings; ticker search and live price/dividend valuation. |
| `/plan` | `app/plan/page.tsx` | **Plan** — the dense numbers dashboard: the recommended withdrawal strategy and tax picture. |
| `/projection` | `app/projection/page.tsx` | **Forecast** — the year-by-year lifetime projection and confidence (Monte-Carlo) view. |
| `/scenarios` | `app/scenarios/page.tsx` | **Compare** — scenario lab: head-to-head plan comparisons, crossover analysis, CSV export. |
| `/learn` | `app/learn/page.tsx` | **Learn** — plain-English explanations of the methodology. |

#### API routes (`/api/ticker/*`) — the price proxy

Stateless Node-runtime (`runtime = "nodejs"`, `force-dynamic`) route handlers that proxy **Yahoo Finance** so the browser can fetch market data without CORS problems. They hit Yahoo's raw endpoints directly (not the `yahoo-finance2` lib, whose strict schema validator throws 502s when Yahoo renames a field). **Privacy is a first-class invariant: only ticker symbols / the search box's text are ever sent; balances, share counts, ages, and identity stay on-device, and queries are deliberately not logged.**

- `app/api/ticker/search/route.ts` — ticker autocomplete (cached 5 min, `s-maxage=300`).
- `app/api/ticker/chart/route.ts` — price history (cached daily).
- `app/api/ticker/dividends/route.ts` — trailing dividends + growth for the dividend model.

(`app/api/audit-scenarios/route.ts` also exists — an internal audit/QA endpoint, not part of the user-facing flow.)

### Engine module map (`lib/`)

The pure-TS engine, roughly in dependency order from data model → tax → projection → simulation → advice.

**Core model & tax**
- `accounts.ts` — household/account model; the three tax buckets (pretax / roth / taxable) that drive every withdrawal decision.
- `tax/constants.ts` — single source of truth for 2026 federal MFJ tax numbers (brackets, deductions, IRMAA tiers).
- `tax/engine.ts` — pure federal tax engine; computes the whole coupled picture (ordinary income, SS taxability, capital-gains stacking, IRMAA) in one place.
- `tax/state.ts` — state income tax (Illinois flat 4.95% today, structured for more states).
- `socialSecurity.ts` — per-person SS claiming math (PIA → benefit by claim age).
- `mortality.ts` — Gompertz longevity model calibrated to the SSA 2021 life table (last-survivor probability for couples).
- `dividends.ts` — per-holding dividend-income projection (shares × DPS, with growth).

**Projection & withdrawal logic**
- `projection.ts` — the multi-year lifetime projection: plan year → withdraw → handle RMDs → grow → inflate, accumulating lifetime tax.
- `optimizer.ts` — the core withdrawal optimizer: which accounts to draw from and how much to minimize federal tax while always satisfying RMDs.
- `rothConversion.ts` — Roth-conversion ("RMD tax-bomb defuser") overlay analysis.

**Return models (feed Monte Carlo)**
- `returns.ts` — forward-looking capital-market assumptions derived from the actual holdings; per-asset-class params + correlation matrix.
- `returnsHistorical.ts` — historical block-bootstrap engine (real U.S. market history 1928–2024).
- `returnsRegime.ts` — Hardy RSLN-2 regime-switching lognormal engine (bull/bear hidden Markov chain).

**Simulation**
- `monteCarlo.ts` — multi-asset Monte-Carlo "probability of success."
- `compareMonteCarlo.ts` — paired (common-random-numbers) head-to-head between two plans.
- `recommendMonteCarlo.ts` — "most money" probability ranking across candidate plans.

**Advice & exploration**
- `goals.ts` — goal-based robo-advisor: turns a chosen objective into a concrete plan by scoring a grid of candidates.
- `scenarioLab.ts` — data layer behind the Compare tab (curated scenarios, year rows, crossover).
- `spendingSweep.ts` / `spendImpact.ts` / `spendingSolver.ts` — "how much can I spend?" tools: ending-value sweep, this-year tax/IRMAA impact, and the bisection sustainable-spend solver.
- `stressTest.ts` — deterministic sequence-of-returns stress scenarios.
- `opportunities.ts` / `actionPlan.ts` / `milestones.ts` — rule-based callouts, year-by-year to-do list, and decision-point detection.

**Support**
- `demo.ts` — the built-in example household(s). `defaults.ts` — `PlannerSettings`, goals, empty/seed households. `prices.ts` — client price fetch/cache layer over `/api/ticker/*`. `crypto.ts` — Web Crypto at-rest encryption (PBKDF2-SHA256 → AES-GCM). `sources.ts` — citation registry (IRS/SSA/CMS). `format.ts` / `palette.ts` — formatting and chart colors. `calibrated/` — offline-calibrated data (`mortality.json`, `regimes.json`).
```

---

## The Tax Engine (2026, professional-grade)

The tax engine lives in three files: `lib/tax/engine.ts` (pure calculation, no I/O), `lib/tax/constants.ts` (the single source of truth for every statutory number), and `lib/tax/state.ts` (Illinois state tax). Its central design principle is stated at the top of `engine.ts`: retirement-withdrawal taxation is *coupled* — one pre-tax IRA dollar can simultaneously make more Social Security taxable AND push capital gains from the 0% band into 15%. So `computeTaxes(input: TaxInput): TaxResult` computes the entire return in one pass rather than taxing each source in isolation.

All figures below are the 2026 nominal values hard-coded in `constants.ts`. The engine inflation-indexes brackets/deductions/IRMAA tiers (but not statutory SS/NIIT thresholds) via the `inflationFactor` input; this is covered under [Inflation indexing](#inflation-indexing).

### Federal ordinary brackets

Applied by `applyBrackets()` (progressive slicing) with the marginal rate read by `ordinaryMarginalRate()`. `ORDINARY_BRACKETS_MFJ` and `ORDINARY_BRACKETS_SINGLE` give the top of each bracket (`upTo`):

| Rate | MFJ `upTo` | Single `upTo` |
|------|-----------:|--------------:|
| 10% | 24,800 | 12,400 |
| 12% | 100,800 | 50,400 |
| 22% | 211,400 | 105,700 |
| 24% | 403,550 | 201,775 |
| 32% | 512,450 | 256,225 |
| 35% | 768,700 | 640,600 |
| 37% | ∞ | ∞ |

The single column is roughly half-width — this is what drives the surviving-spouse "widow's penalty," and why the engine accepts `filingStatus: "single"` to model a survivor. Status-dependent constants are dispatched through `FILING_CONSTANTS[status]`.

### Standard deduction, age-65 additional, and OBBBA senior bonus

Total deductions (in `computeTaxes`) are the sum of three layers:

1. **Base standard deduction** — `STANDARD_DEDUCTION_MFJ = 32,200` / `STANDARD_DEDUCTION_SINGLE = 16,100` (indexed).
2. **Age-65 additional standard deduction**, per spouse 65+ — `ADDL_STD_DEDUCTION_65 = 1,650` (MFJ, per spouse) / `ADDL_STD_DEDUCTION_65_SINGLE = 2,050` (single). Multiplied by `input.num65Plus`. Permanent, indexed.
3. **OBBBA "senior bonus"** — `seniorBonusDeduction()`, `SENIOR_BONUS_DEDUCTION = 6,000` per filer 65+. This exists **only for tax years 2025–2028** (`if (year > 2028) return 0;`, OBBBA §70103) and its dollar amount and phaseout thresholds are **statutory fixed dollars — NOT inflation-indexed**.

The senior-bonus **phaseout** is the subtle part. It reduces the *aggregate* deduction (the combined `6,000 × num65Plus`) by `SENIOR_BONUS_PHASEOUT_RATE = 6%` of MAGI over the threshold, **once** — not each filer's $6,000 independently:

```
gross = 6,000 × num65Plus
return max(0, gross − max(0, magi − phaseoutStart) × 0.06)
```

Thresholds (`SENIOR_BONUS_PHASEOUT_START_*`): **$150,000 MFJ / $75,000 single**. So an MFJ couple with both spouses 65+ phases the combined $12,000 out over a **$150k–$350k** MAGI band (not $150k–$250k). A single filer's $6,000 phases out over $75k–$175k.

### Long-term capital gains — 0/15/20, stacked on ordinary income

`LTCG_BRACKETS_MFJ` / `LTCG_BRACKETS_SINGLE` give the taxable-income breakpoints:

| Rate | MFJ `upTo` | Single `upTo` |
|------|-----------:|--------------:|
| 0% | 98,900 | 49,450 |
| 15% | 613,700 | 545,500 |
| 20% | ∞ | ∞ |

Preferential income is `qualifiedDividends + longTermGains`. The critical mechanic: **deductions come off ordinary income first, and gains stack on top of ordinary taxable income.** The engine computes `preferentialInTaxable = min(preferential, taxableIncome)` and `ordinaryTaxableIncome = taxableIncome − preferentialInTaxable`, then taxes the gains by **difference**:

```
capitalGainsTax = brackets_ltcg(ordinary + pref) − brackets_ltcg(ordinary)
```

This correctly captures the case where ordinary income partially fills the 0% room and gains spill into 15%. The `capitalGainsRate` output is the LTCG bracket the *top* of the stack lands in. `LTCG_ZERO_CEILING` and the status-aware `ltcgZeroCeiling(status)` expose the 0%-band ceiling (98,900 MFJ) for callers doing gain-harvesting decisions.

### NIIT — 3.8% over the MAGI threshold

`NIIT_RATE = 0.038`. The base is net investment income = `qualifiedDividends + longTermGains + taxableInterest + ordinaryDividends`. Tax is 3.8% of the **lesser** of NII or MAGI over the threshold:

```
niit = 0.038 × max(0, min(netInvestmentIncome, magi − niitThreshold))
```

`NIIT_THRESHOLD_MFJ = 250,000` / `NIIT_THRESHOLD_SINGLE = 200,000`. These are **statutory and NOT inflation-indexed** (intentionally fixed in code). Note pre-tax withdrawals and Social Security are *not* investment income, but they raise MAGI and can therefore pull investment income over the threshold.

### Social Security taxation and the "tax torpedo"

`taxableSocialSecurity(ssBenefits, otherIncome, ssBase, ssSecond)` implements the IRS provisional-income worksheet. `otherIncome` is everything in AGI except SS itself (ordinary + preferential) **plus tax-exempt muni interest** (the worksheet adds it back). Provisional income = `otherIncome + 0.5 × ssBenefits`.

- Below `ssBase` → **$0 taxable**.
- Between `ssBase` and `ssSecond` → `min(0.5 × benefits, 0.5 × (provisional − ssBase))` (the 50% band).
- Above `ssSecond` → `0.85 × (provisional − ssSecond) + min(tier1, 0.5 × benefits)`, where `tier1 = min(0.5 × (ssSecond − ssBase), 6,000)`, capped at **85% of benefits**.

Thresholds (`SS_BASE` / `SS_SECOND`): **$32,000 / $44,000 MFJ**, **$25,000 / $34,000 single** — statutory, **not indexed** (this is exactly why the torpedo worsens in real terms over time). The "tax torpedo": because each extra dollar of other income can make $0.50–$0.85 of an SS dollar newly taxable, the *effective* marginal rate on ordinary income inside the phase-in range can far exceed the statutory bracket rate. The engine captures this automatically via the finite difference below.

### Effective marginal rate (finite difference)

The statutory bracket rate misses the torpedo, NIIT, and the senior-bonus phaseout. So `effectiveMarginalRate` is computed by **finite difference**: bump `preTaxWithdrawals` by `dx = 1,000`, recompute total tax with `_noMarginal: true` (a guard flag that prevents infinite recursion), and take `(bumped.totalTax − totalTax) / dx`. This is the TRUE marginal cost of the next ordinary dollar (federal + state) and is what rate-arbitrage conversion decisions should compare against. IRMAA is deliberately excluded here — it is not an income tax and uses a 2-year MAGI lag. `marginalOrdinaryRate` (the plain statutory rate) is reported separately.

### IRMAA — Part B + Part D, per-enrollee, 2-year MAGI lookback

`irmaaFor(magi, factor, tiers, enrollees)` bills the Medicare surcharge. Key behaviors:

- **Per-enrollee**: `householdAnnual = monthlyPerPerson × 12 × enrollees`, where `enrollees = input.num65Plus`. A couple aged 63/61 pays $0 ("Not yet on Medicare"); IRMAA only starts at Medicare eligibility (65).
- **2-year MAGI lookback**: IRMAA for premium year T is set by year T−2 MAGI. The caller passes that via `input.irmaaMagi`; if omitted, the engine falls back to the current year's `magi`.
- `monthlyPerPerson` is the **combined Part B + Part D** surcharge (the extra above the standard premium); the tiers also break out `partB`/`partD` separately for reconciliation against CMS's two tables.

2026 tiers (`monthlyPerPerson`, with `upTo` as top of each MAGI tier):

| MFJ `upTo` | Single `upTo` | $/mo per person | Part B | Part D |
|-----------:|--------------:|----------------:|-------:|-------:|
| 218,000 | 109,000 | 0 | 0 | 0 |
| 274,000 | 137,000 | 96 | 81.20 | 14.50 |
| 342,000 | 171,000 | 240 | 202.90 | 37.50 |
| 410,000 | 205,000 | 385 | 324.60 | 60.40 |
| 750,000 | 500,000 | 530 | 446.30 | 83.30 |
| ∞ | ∞ | 578 | 487.00 | 91.00 |

Standard Part B premium is $202.90/mo. The Part B piece dominates; Part D tops out near $91/mo. Tier `upTo` boundaries are inflation-indexed (`tier.upTo * factor`) even though the surcharge dollars are not.

### Illinois state tax (`state.ts`)

`computeStateTax(input, state = "IL")` via `STATE_TAX["IL"]`. Illinois is a **flat 4.95%** (`rate: 0.0495`) with no brackets and no preferential capital-gains rate. The defining feature for this app: **Illinois exempts all retirement income**. Its `taxableBase` is *only* investment income:

```
taxableBase = taxableInterest + ordinaryDividends + qualifiedDividends + longTermGains
```

So pre-tax IRA/401(k) withdrawals, **RMDs, Roth conversions**, pensions, and Social Security add **$0** of Illinois tax. This is why the finite-difference `effectiveMarginalRate` on a conversion has a ~0 state component — correct, because a conversion is state-tax-free in Illinois.

**Exemptions** (subtracted before the rate): a personal exemption `IL_PERSONAL_EXEMPTION = 2,925` per person (2026, cost-of-living indexed), plus `IL_SENIOR_EXEMPTION = 1,000` per person 65+ (fixed, not indexed). The personal exemption phases to **$0** entirely once AGI exceeds the statutory limit — `500,000 MFJ` / `250,000 single`. The `"none"` state config zeroes everything for users outside Illinois.

### Inflation indexing

`computeTaxes` reads `inflationFactor` (default 1) and scales the **ordinary brackets, LTCG brackets, standard + age-65 deductions, IRMAA tier boundaries, and the IL personal exemption** via `indexedBrackets()` (it leaves `Infinity` untouched). Deliberately **NOT** scaled: the Social Security thresholds, the NIIT threshold, the senior-bonus $6,000 and its phaseout start, and the IL $1,000 senior exemption — all statutorily fixed, so they bite harder in real terms over a projection.

### Arbitrage / bracket-ceiling helpers

Two exported helpers support Roth-conversion sizing; both return **nominal 2026** values that a projection must multiply by that year's `inflationFactor`:

- **`ordinaryBracketCeiling(rate, status = "mfj")`** — the `upTo` of the ordinary bracket whose rate equals `rate` (e.g. 22% MFJ → 211,400).
- **`arbitrageCeiling(futureEffRate, status = "mfj")`** — the income level at which the statutory marginal rate *first reaches* the projected future rate being avoided, returning the **floor** of the first bracket at/above that future rate. Because `futureEffRate` is an *effective* rate (folding in the torpedo/IRMAA/NIIT) it rarely equals a bracket rate exactly, so the comparison is `b.rate >= futureEffRate − 1e-9` rather than exact match — the prior exact-match version returned `Infinity` for any effective rate, silently disabling the ceiling. Filling pre-tax up to this ceiling converts only dollars taxed *strictly below* the future cost. Example (MFJ): a 24% future rate → top of the 22% bracket (a wash at 24% is excluded); a ~27% effective future rate → top of the 24% bracket (24% < 27%, still strictly cheaper).

---

## The Lifetime Projection

`projectLifetime(household, assumptions)` in `lib/projection.ts` is the engine's core simulation. It walks the household forward one year at a time, draws money out of the real accounts, grows what's left, inflates next year's spending, and accumulates lifetime federal tax and Medicare IRMAA so two strategies can be compared apples-to-apples. It returns a `ProjectionResult` containing one `ProjectionRow` per year plus the lifetime aggregates and the ending estate.

Everything operates on a deep copy: `cloneHousehold(household)` clones the household, both `Person` records, and every `Account`, so the projection never mutates the caller's inputs (a baseline projection can be run inside the recommended-conversion path without corrupting state).

### The year-by-year loop and its ordering

The loop runs `for (year = startYear; year <= startYear + 60; year++)` — a 61-year horizon (`startYear = new Date().getFullYear()`) — and breaks early once **both** spouses are older than `endAge` (`if (selfAge > endAge && spouseAge > endAge) break`). `selfAge` and `spouseAge` are recomputed each year from `year - birthYear`.

Each iteration executes in a deliberate, fixed order. The ordering is load-bearing — taxes, IRMAA, and the dividend carve-out all depend on it:

1. **Snapshot start balances.** `startBalances` sums the pre-tax, Roth, and taxable buckets (via `bucketOf`) and their total. This is recorded on the row before any money moves.
2. **Set the inflation index.** `inflationFactor = priceLevel` (the cumulative price level at the *start* of this year). It is handed to the tax engine to index brackets/deductions/IRMAA tiers and reused below as the real-dollar deflator — one number, no drift.
3. **Scale this year's investment income (the tax drag).** Dividends and interest are rescaled to the current balances. With per-holding dividend data (`useDivModel`, from `dividendBreakdown`), qualified/ordinary dividend income = base × modeled `bucketGrowthFactor` growth path × `shareFraction` (the fraction of the original dividend-paying position still held — moved only by actual sales/reinvestment, never by price). Without holdings data it falls back to the entered household totals scaled by the current brokerage balance (`divFactor`) and cash balance (`intFactor`). The results are written to `h.brokerageDividendsAnnual`, `h.ordinaryDividendsAnnual`, `h.taxExemptInterestAnnual`, `h.taxableInterestAnnual`.
4. **Apply the survivor transition** (if this is the first year on/after the older spouse's death — see below).
5. **Plan the year.** `planYear(h, {...})` (in `lib/optimizer.ts`) returns a `YearPlan`: the RMD, the withdrawal split (`withdrawals.pretax` **includes** the RMD), any Roth conversion + its tax, the full tax result, `netCash`, `spendingTarget`, and `shortfall`. It is passed the year's `inflationFactor`, the `filingStatus`, and `irmaaMagi: magiByYear.get(year - 2)` — the statutory 2-year IRMAA MAGI lookback. This year's MAGI is then recorded: `magiByYear.set(year, plan.tax.magi)`.
6. **Withdraw, in bucket order.** `drawFromBucket` is called for pre-tax (RMD-inclusive), then taxable, then Roth. Pre-tax and Roth are drawn pro-rata across accounts. The **taxable** bucket is drawn **cash-first**: `cash` accounts (zero embedded gain) are drained before any appreciated brokerage, minimizing realized capital gain and preserving the most-appreciated lots for the step-up at death. Brokerage is then sold pro-rata on blended basis, with `costBasis` reduced proportionally. The brokerage balance is sampled before and after the taxable draw to update `shareFraction` (only an actual sale cuts future dividends).
7. **Convert pre-tax → Roth, tax paid from cash.** If `plan.conversion > 0`, `applyConversion` pulls the gross from pre-tax, pays `plan.conversionTax` via `payConversionTaxFromCash` (cash/savings **only** — it deliberately does not sell appreciated brokerage, because that gain isn't recursively re-taxed in this model and allowing it would flatter conversions), and credits the net to the largest Roth (`creditRoth`). Any tax that cash couldn't cover is *withheld* from the conversion itself — landing as a taxable distribution rather than Roth, slightly conservative and never overstated. `totalConverted` accrues the gross.
8. **Pay the IRMAA cash cost.** The Medicare IRMAA surcharge (`plan.tax.irmaa.householdAnnual`) is **not** an income tax and is **not** inside `plan.tax.totalTax` or `netCash`. It is a real out-of-pocket cash outflow paid this year so those dollars leave the compounding base. A forced-RMD surplus (`leftover = plan.netCash - plan.spendingTarget`) covers it first; `reinvestAmt = max(0, leftover - irmaaCost)` is reinvested into the brokerage as new full-basis money (`reinvestSurplus`), while any uncovered premium (`premiumFromSavings`) is drawn from savings cash-first.
9. **Accumulate lifetime aggregates.** `lifetimeTax`, `lifetimeIrmaa`, and their real-dollar counterparts (`/inflationFactor`) accrue; `peakRmd`, `peakRmdMarginal`, and `peakMarginalRate` update; `minSpendRatio` records the deepest real-spend cut (`plan.spendingTarget / inflationFactor / refSpend`).
10. **Grow balances.** `growAll(h.accounts, rate)` multiplies every non-cash account by `1 + rate` (cash is treated as non-growing). `rate` is `returnFor(yearIndex)` under Monte Carlo, else the flat `returnRate`.
11. **Carve out dividends so they don't double-compound.** Immediately after growth, `distributeFromBrokerage` removes this year's `brokerageDividendsAnnual + ordinaryDividendsAnnual + taxExemptInterestAnnual` from the brokerage balance (balance only — dividends aren't return of capital, so basis is unchanged and the unrealized gain correctly shrinks). These dollars were already received as taxable income funding spending; leaving them to *also* compound would double-count and over-credit the taxable account versus a tax-free Roth. This is the structural reason a taxable account lags a Roth in the model.
12. **Record the row and check for shortfall.** `endTotal` is summed, the `ProjectionRow` is pushed, and `depleted` flips true on the first year with `plan.shortfall > 1`.
13. **Advance spending, COLA, and the price level for next year.** Using this year's realized return/inflation (`yearReturn`, `yearInfl`): spending grows per the spending strategy (below), both spouses' Social Security gets the inflation COLA, and `priceLevel *= 1 + yearInfl` advances the index to next year's start.

### RMDs

RMDs are computed in `computeRmd(household, year)` (optimizer.ts) and surfaced as `plan.rmd` / the `ProjectionRow.rmd` field. They apply to **pre-tax accounts only** (Roth has no lifetime RMD for the owner) and are computed **per owner**:

- **Start age (SECURE 2.0), by birth year** — `rmdStartAge(birthYear)`: born ≤ 1950 → **72**; 1951–1959 → **73**; 1960 or later → **75**.
- **Divisor** — `uniformLifetimeFactor(age)` looks up the IRS **Uniform Lifetime Table** (post-2022 update), e.g. age 73 → 26.5, 75 → 24.6, 80 → 20.2, 90 → 12.2, capped at the age-120 floor of 2.0. Ages below the start have factor 0 (no RMD).
- **Amount** — for each of `self` and `spouse`, sum that owner's pre-tax balances, and if `age >= startAge`, RMD = `pretaxBalance / factor`. The current balance approximates the prior year-end balance. Totals are summed across owners. A non-real spouse (sentinel `birthYear <= 1900`) is skipped so it can't emit a phantom RMD.

In the loop, the RMD is satisfied first: it is part of `withdrawals.pretax`, so the cash-first/pro-rata draw pulls it out before any voluntary withdrawal or conversion.

### The three tax buckets and basis

Buckets are defined in `lib/accounts.ts` via `bucketOf(kind)` / `ACCOUNT_KIND_META`:

- **pretax** — Traditional/rollover IRA & 401(k), 403(b), 457(b), TSP-traditional, SEP/SIMPLE/Solo. Every dollar out is ordinary income; subject to RMDs (`hasRmd: true`).
- **roth** — Roth IRA/401(k)/403(b), TSP-Roth. Tax-free out, no lifetime RMDs.
- **taxable** — `brokerage` and `cash`. Only the *gain* portion of a sale is taxed (preferential LTCG rates); no RMDs.

**Basis** lives on the taxable accounts only (`Account.costBasis`; ignored for pre-tax/Roth). Unrealized gain = `balance − costBasis`. On a taxable draw, `costBasis` is scaled down proportionally to the amount sold (`costBasis *= 1 - take/balance`), so blended basis is preserved across partial sales. Cash carries no embedded gain, so the cash-first draw realizes zero gain. Reinvested surplus enters as new money with full basis (`costBasis += amount`). Where holdings line items exist, `syncAccountFromHoldings` keeps `balance`/`costBasis` in sync with shares × price and shares × cost-per-share.

### The survivor (widow's-penalty) transition

When `assumptions.survivor = { firstDeathAge, spendingFactor }` is set and the household is genuinely a couple, the model ages the **older** spouse to death and runs the survivor's single-filer years. Setup: `olderWho` is whoever has the smaller `birthYear`; `survivorWho` is the other; `firstDeathYear = h[olderWho].birthYear + firstDeathAge`.

The transition is applied **once**, the first year `year >= firstDeathYear`:

- The survivor keeps the **larger** of the two Social Security checks (`keptBenefit = max(self, spouse)` via `adjustedAnnualBenefit`), assigned with a neutral FRA claim age; the deceased's benefit goes to 0.
- The survivor **inherits the pre-tax** (spousal rollover): every account owned by `olderWho` is reassigned to `survivorWho`, so RMDs thereafter run on the **survivor's** age and start age.
- Spending drops to `annualSpending *= spendingFactor`, and the guardrail reference spend `refSpend` is recentered to the same lower base.

From that year on `filingStatus = "single"` (half-width brackets, single standard deduction, single IRMAA headroom) — the "widow's penalty."

A genuinely single household is detected up front by `isSingle = !(spouse && spouse.birthYear > 1900)`. Such a person files **single for the entire projection** and the survivor transition never runs (no spending cut, no SS reassignment). Without this guard a single retiree would be silently taxed on the MFJ curve for life, overstating the estate and understating lifetime tax.

### Inflation indexing and real-dollar deflation

A single cumulative price level `priceLevel` (initialized to 1) is built as a running **product** of each year's realized inflation — constant `inflationRate` normally, or a stochastic AR(1) path via `inflationFor(yearIndex)` under Monte Carlo. Each year's `ProjectionRow.inflationFactor` is the price level at that year's start. This one number drives every inflation-sensitive site:

- the tax engine indexes brackets, deductions, and IRMAA tiers by it;
- it deflates nominal tax/IRMAA to today's dollars (`lifetimeTaxReal += totalTax / inflationFactor`);
- spending grows by `1 + yearInfl` (for constant-real spending), and Social Security gets the same COLA.

Because brackets and the deflator share the index, real comparisons never drift. The final `priceLevel` (`endDeflator`) deflates the ending estate to today's dollars.

**Spending strategies** (`spendingStrategy`): `"constant"` (default) holds real spending steady (nominal grows with inflation); `"flatNominal"` keeps the same dollar amount forever (real value erodes); `"guardrails"` applies Guyton-Klinger dynamic spending via `guytonKlinger(...)` — skip the inflation raise after a down year if already above the initial withdrawal rate (Modified Withdrawal Rule), cut 10% when the rate runs >20% above initial (Capital-Preservation, suspended in the final ~15 years), raise 10% when >20% below (Prosperity Rule).

### The ending after-tax estate

After the loop, ending bucket balances are summed: `endPretax`, `endRoth`, `endTaxable`, and `endTaxableGain` (sum of `max(0, balance − costBasis)` across taxable accounts). These populate `endingBuckets`.

- `endingEstate` (the gross total left) = `endPretax + endRoth + endTaxable`.
- **`endingEstateAfterTax`** = `max(0, endPretax × (1 − heirTaxRate) + endRoth + endTaxable)`.
  - **Pre-tax** is income in respect of a decedent — no step-up. A non-spouse heir must drain it within the SECURE 10-year window, so it is valued at the heir's assumed marginal rate `heirTaxRate` (`assumptions.heirTaxRate`, default `ASSUMED_LIQUIDATION_RATE = 0.22`; the calling layer commonly passes 0.24).
  - **Roth** is already tax-free, counted at full value.
  - **Taxable** gets the **full step-up in basis at death** (IRC §1014): the embedded unrealized gain is forgiven, so the brokerage is counted at full balance with $0 income tax.
  - Lifetime IRMAA is **not** subtracted here — it was already paid as a real cash outflow each year, so the surviving balances reflect it; `lifetimeIrmaa` is kept only as a reported cost line.

There is also a `netWealthRobust` variant (used by the ranking layer, outside this function) that is more conservative on the brokerage: instead of granting the full step-up, it taxes the embedded brokerage **gain** at **15%** (LTCG), i.e. `endTaxable − 0.15 × endTaxableGain`. The in-function `endingEstateAfterTax` grants the full step-up; the robust variant prices the gain at 15% so step-up-dependent plans can't dominate the ranking on a benefit that may not materialize.

Real-dollar versions divide by `endDeflator` (`endingEstateReal`, `endingEstateAfterTaxReal`). The result also reports `solventYears` (years funded before the first shortfall, = `rows.length` if never short), `minRealSpendRatio`, `totalConverted`, `peakRmd`, `peakMarginalRate`, `futureRate`, and `survivorYear`.

The relevant source files are `/Users/brian/retirement-app/lib/projection.ts`, `/Users/brian/retirement-app/lib/accounts.ts`, `/Users/brian/retirement-app/lib/optimizer.ts` (`computeRmd`, `planYear`), and `/Users/brian/retirement-app/lib/tax/constants.ts` (`rmdStartAge`, `UNIFORM_LIFETIME_TABLE`, `uniformLifetimeFactor`).

---

## The Optimizer, Recommender & the "Most Money" Probability Engine

This is the advice core of the app: three layers that turn a household's accounts, ages, and spending into a concrete, defensible plan. `planYear` (in `lib/optimizer.ts`) decides one year's withdrawals and any Roth conversion; `recommendPlan` (in `lib/goals.ts`) grid-searches whole-lifetime configurations and ranks them against the user's goal; and `rankMostMoney` (in `lib/recommendMonteCarlo.ts`) replaces the single-deterministic-path pick for the *maximum-capital* goal with a probability ranking over simulated markets.

> All three are explicitly **educational estimates, not tax advice** — the disclaimer is repeated in every file header.

### `planYear` — one year's withdrawal decision

`planYear(household, params)` builds a single `YearPlan`. `household.annualSpending` is the desired **after-tax** spend; the engine grosses it up to cover the resulting tax. The sequence:

1. **RMD first (mandatory).** `computeRmd` totals per-owner Required Minimum Distributions on **pre-tax** balances only (Roth has no lifetime owner RMD), using `rmdStartAge` (73/75 per SECURE 2.0) and `uniformLifetimeFactor`. A guard skips the "no spouse" sentinel (`birthYear <= 1900`) so a phantom age-130 RMD is never emitted. The RMD is drawn from pre-tax and is *included* in `withdrawals.pretax`.

2. **Fill the spending gap by strategy** (`StrategyId`), each filling via `solveBucket` — a 40-iteration bisection on the net-cash-vs-draw curve (monotone, but bent by Social Security taxability and gain stacking, so it can't be solved closed-form):
   - **`smart` (bracket-fill):** fill pre-tax up to `ordinaryBracketCeiling(bracketTarget, filingStatus) * inflationFactor` via `pretaxRoomToTarget`, then brokerage, then Roth, then any remaining pre-tax. `bracketTarget` is one of `0.12 | 0.22 | 0.24 | 0.32`.
   - **`conventional`:** brokerage first, then pre-tax, then Roth (the common rule of thumb).
   - **`proportional`:** pull pro-rata across remaining balances (rough 1.4× gross-up, then trimmed).

3. **Cash-first taxable draws.** Taxable withdrawals spend the zero-gain **cash** tranche (`cashTaxable`) before selling appreciated brokerage; only dollars beyond cash realize long-term gain at `brokerageGainFraction`. This realizes the least capital gain and preserves the most-appreciated lots for the step-up at death. The tax math in `evaluate` mirrors this exactly so the projection's draw order and the tax pass agree.

4. **Effective marginal rate** is computed (a second finite-difference tax pass, `wantMarginal`) only on the *committed* plan — the ~40 bisection probes per year skip it for speed.

### The Roth-conversion rate-arbitrage overlay

After spending is funded (and only if there's no shortfall), the conversion overlay (`ConversionParam`) moves pre-tax → Roth. Three modes:

- **`fillBracket`** — fill ordinary income up to the top of `toBracket` (the advanced manual lever).
- **`fixed`** — a constant dollar conversion, used by the spend-impact sweep so the rollover stays a fixed baseline as spending varies (a re-solving bracket rule would make this year's MAGI move *backwards* as you spend more, breaking the Medicare/tax read-outs).
- **`recommended`** — the smart default, true rate arbitrage:
  - `futureRate` is the **worst future RMD-era *effective* marginal rate** the household would face if it did nothing extra. It comes from an inner **conventional, no-conversion baseline** projection (forced RMDs, minimal voluntary draws), keeping the survivor model so the target reflects the survivor's steeper single-filer rates: `futureRate = max over RMD years of effMarginalRate`. Effective (not statutory) means it folds in the Social Security tax torpedo, NIIT, and the senior-bonus phaseout.
  - **Convert only while this year is strictly cheaper:** the overlay runs only when `rNow < futureRate - 1e-9`, where `rNow` is *this* year's committed `effectiveMarginalRate` (likewise effective).
  - **Fill up to `arbitrageCeiling(futureRate)`** — the income level where the *statutory* marginal rate **first reaches** the future rate, i.e. the floor of the first bracket whose rate is `>= futureRate`. Filling to here converts only dollars taxed strictly below the future cost. Example (MFJ): a 24% future rate → top of the 22% bracket; a ~27% effective future rate → top of the 24% bracket (24% < 27% is still strictly cheaper, so it's included).
  - **Capped by the comfort bracket.** The final `targetOTI = min(arbitrageCeiling, ordinaryBracketCeiling(bracketTarget)) * inflationFactor`, optionally further capped by `capOTI`. This keeps rollovers steady and low-bracket rather than one huge conversion that itself jumps into a high bracket; pushing past the comfort bracket is the deliberate `fillBracket` opt-in.

> **Real fix worth noting.** `arbitrageCeiling` previously matched the future rate to a bracket by *equality* (`b.rate === futureEffRate`). Because `futureRate` is an effective rate, it almost never equals a statutory rate, so the lookup returned `Infinity` for nearly every household — silently disabling the ceiling. The current code iterates brackets and returns the floor of the first bracket whose statutory rate meets or exceeds the future rate, with `-1e-9` slack.

`ordinaryBracketCeiling` and `arbitrageCeiling` return **nominal 2026** values; `planYear` scales them by `inflationFactor`. Conversion tax is the incremental `totalTax` over the no-conversion `finalEval` and (in IL) is federal-only since Illinois exempts conversions. IRMAA and NIIT notes reflect the conversion income.

### `recommendPlan` — grid search & ranking

`recommendPlan(household, inputs, goal, opts)` searches the full realistic decision space and lets the numbers pick per goal.

**Grid (`CONFIGS`, built once by `buildConfigs`):**
- Withdrawal **order** ∈ `{conventional, smart, proportional}` (`STRATEGIES`).
- Conversion **bracket ceiling** ∈ `{0.12, 0.22, 0.24, 0.32}` (`CONV_BRACKETS`). For big pre-tax balances, converting up into 32% during the window can beat the 35%+ RMDs it later forces.
- Conversion **mode** ∈ `{recommended, fillBracket}`, plus no-conversion baselines.
- For no-conversion baselines, `bracketTarget` only changes the *withdrawal* order under `smart`, so only `smart` gets all four ceilings; the others get one.

Each config is run through `projectLifetime` by `evaluateConfig`, producing `PlanMetrics`: `netWealth` (after-tax estate, full step-up), `netWealthRobust`, `lifetimeTax`, `taxPct`, `peakRmd`, `lifetimeIrmaa`, `totalConverted`, `depleted`, `solventYears`.

**The three goals (`GoalId`) and `score`:**
| Goal | Score (higher = better) |
|---|---|
| `maxCapital` — most after-tax money | `m.netWealth` |
| `lowestTax` — smallest lifetime bill | `-m.lifetimeTax` |
| `lowestRate` — low & steady rate | `-(m.taxPct * 1e9 + m.lifetimeIrmaa)` (rate dominates; IRMAA breaks ties) |

A **depleted** plan always scores below any solvent plan: `-1e12 + m.solventYears`, so among failing plans the one that funds spending longest still ranks higher (a near-miss isn't equated with one that runs dry a decade early).

**Step-up-robustness tie-break (`rankCandidates`, `maxCapital` only).** `netWealth` assumes the brokerage's unrealized gain gets a full step-up at death — an all-or-nothing bet. Among contenders within **2%** of the top plan's `netWealth`, the engine re-sorts by `netWealthRobust` (estate with that gain instead taxed at `ROBUST_LTCG_RATE = 0.15`) and promotes the most-robust one. This prevents recommending a plan that "wins" only by hoarding a gain-laden brokerage.

**Staged search.** Stage 1 picks the best config at the entered settings. Stage 2 (`searchWindow`, only if the winner uses conversions) searches the **conversion-window end-age** over `{current, 73, 75, 80, firstDeath−1}` (filtered to the valid range) on the winning config — additive, so it can only improve the goal. Stage 3 (`optimizeClaimAge`) is the **Social Security claim-age optimizer**: it scores each `(self, spouse)` claim pair over `{62, FRA, 70, current}` using the *same* goal score on the chosen config + window. Because the score runs the projection to the household's own `endAge`, longevity is baked in — at a short horizon, delaying scores worse and earlier claiming wins. It's surfaced as `ClaimAdvice` (with the dollar `lift` and `delayWho`) only when the change is real (`lift > 10_000`), **never auto-applied** — claiming age is too personal a decision to change silently.

`buildRationale` produces the plain-English reason, and `analyzeConversions` (`lib/rothConversion.ts`) runs the chosen plan baseline-vs-overlay to report `estateGain`, `lifetimeTaxDelta`, and the headline `peakRmdReduction`, flagging `recommended` when `pretaxShare > 0.4`, `totalConverted > 10_000`, not depleted, and (`estateGain > 1_000` or `peakRmdReduction > 10_000`).

### The "most money" probability engine (`rankMostMoney`)

For `maxCapital`, the right question isn't "which plan wins on one assumed return?" but **"which plan most likely leaves you the most?"** `rankMostMoney(household, candidates, opts)` answers it.

**Common random numbers.** It generates simulated market paths once and replays the **same paths through every candidate plan** (default `runs = 600`, seeded PRNG). Removing the market as a confounder means the ranking reflects the *plans*, not luck. Path generation mirrors `lib/monteCarlo.ts` / `lib/compareMonteCarlo.ts` exactly: multi-asset (equity/bonds/cash) log-normal returns with **fat-tailed Student-t** shocks (`df ≥ 5`, clamped to ±4σ) under a 4×4 Cholesky correlation that includes inflation, and **AR(1) inflation** (`PHI = 0.6`, `SIGMA_INFL = 0.0177`). Each candidate's `futureRate` is computed deterministically up front (`futureRateOverride`), so conversions are sized against the household's real future rate — not the noisy simulated returns.

**Per run:** every candidate is projected on the identical path; the outcome is `endingEstateAfterTaxReal` (today's dollars). The richest plan(s) on that path win the run; exact ties split the share so `winRate` sums to 1. `success` counts non-depleted runs.

**Three user-chosen metrics** (`MostMoneyMetric`, ranked by `argmaxByMetric`):
- **`winRate`** (default) — share of markets where this plan ends **richest** of all candidates: the most literal "highest probability of giving you the most."
- **`median`** — highest typical (50th-pct) ending estate; robust to extremes.
- **`mean`** — highest average (upside-weighted) ending estate.

**Why this beats the single-deterministic-path pick.** A lone assumed-return projection can crown a plan that wins only on that one path and loses across most plausible futures. By scoring all candidates over the *same* hundreds of markets, the engine separates plan quality from market luck and reports a *distribution* — letting the user pick "wins most often," "best typical outcome," or "best average," instead of betting the recommendation on one number.

---

## Monte Carlo & Capital-Market Assumptions

The app answers the retirement question the way high-end planning tools do: not "does the plan work at one assumed return?" but "across thousands of plausible market futures, how often does it fund full spending — and how rich (or poor) is the ending estate?" Four engines drive this, all sharing one return model and one projection kernel (`projectLifetime`): a parametric Monte-Carlo (`lib/monteCarlo.ts`), a paired head-to-head (`lib/compareMonteCarlo.ts`), a most-money probability ranker (`lib/recommendMonteCarlo.ts`), and two distribution-shape cross-checks — a historical block bootstrap (`lib/returnsHistorical.ts`) and a regime-switching engine (`lib/returnsRegime.ts`).

### The multi-asset return model (`lib/returns.ts`)

`returnModel(accounts)` derives the portfolio mix from the household's **actual holdings**, not a hand-typed allocation. Each holding is classified into one of three asset classes:

- `bond_fund` → **bonds**
- `cash` holdings, and any account with `kind === "cash"` → **cash**
- `stock` / `etf` / `mutual_fund` → **equity**

An account that has a balance but no itemized holdings (and isn't a cash account) is split by a generic diversified `ASSUMED_MIX` of 70% equity / 25% bonds / 5% cash. When nothing is entered at all, the same 70/25/5 mix is used as the empty-state fallback. The `basis` field reports whether the mix came from `"holdings"`, `"assumed"`, or `"mixed"` inputs.

The class weights are then combined with **forward-looking capital-market assumptions** (arithmetic-mean nominal annual return and annual standard deviation):

| Class | Mean | Vol |
|---|---|---|
| US large-cap equity | 7.94% | 16.47% |
| US aggregate bonds | 4.91% | 4.76% |
| Cash | 3.10% | 0.67% |

These are the `CMA` constants. The doc comment in `lib/returns.ts` attributes them to **J.P. Morgan's 2026 Long-Term Capital Market Assumptions, cross-checked against Vanguard's VCMM and Morningstar**. The in-app citation registry (`lib/sources.ts`) surfaces two professional sources to the user: `SOURCES.cma` (Vanguard Capital Markets Model — forward return/volatility/correlation forecasts) and `SOURCES.monteCarlo` (T. Rowe Price — how Monte-Carlo analysis works in retirement planning). These are deliberately forward estimates — materially lower than the ~10% historical equity mean at today's valuations.

The correlation matrix `ASSET_CORR` over [equity, bonds, cash] uses an explicitly **post-2022 positive** equity–bond correlation of **+0.16** (not the −0.3 of 2000–2020), so the simulator can produce years where stocks and bonds fall together — the dominant near-retiree threat. Bond–cash is +0.10, equity–cash +0.01.

`returnModel` exposes both a blended headline and the per-class params:

- `expected` — the **arithmetic** blended mean (`Σ wᵢ·meanᵢ`), what the simulation draws around.
- `volatility` — blended one-σ from the **full covariance** via `portfolioVariance(w, vol, corr)`, not a naive weighted average.
- `expectedGeometric = expected − ½·vol²` — the compound rate a deterministic year-by-year projection should compound (compounding the arithmetic mean overstates the median path by the variance drag).
- `conservative` / `optimistic` — brackets around the geometric return, perturbing the equity contribution roughly ±1.5% (plus an equity-weight-scaled term), feeding the deterministic scenario rates.

All headline figures are rounded to the nearest 0.1% via `round1`.

### How a single year is drawn (`runMonteCarlo`)

Default 1,000 runs, seeded mulberry32 RNG (default seed 12345) so the headline is stable per input. Each year of each run draws a correlated, fat-tailed return vector plus a stochastic inflation rate.

**1. Moment-matched lognormal per class.** Each class's arithmetic `(mean, vol)` is converted to lognormal log-space params so that simulated **simple** returns hit the intended mean and vol and can never fall below −100%:

```
sig2  = log(1 + vol² / (1+mean)²)
muLog = log(1+mean) − sig2/2
sd    = sqrt(sig2)
```

**2. Joint draws via Cholesky of a 4-dimensional correlation matrix.** The 3×3 `ASSET_CORR` is extended to **4×4 by appending inflation** as a fourth dimension. Inflation is negatively correlated with bonds (`−0.24`), and near-zero with equity (`−0.01`) and cash (`−0.03`) — so the engine can reproduce a 1966/2022-style year where bonds fall *while* inflation spikes. `cholesky()` factors this 4×4 into a lower-triangular `L` (it clamps tiny negative diagonals to 0 so a near-singular hand-entered matrix can't NaN). Four independent standard normals (`randn`, Box–Muller) are correlated by `L` into `z[0..3]`.

**3. Fat tails via a multivariate Student-t.** A single chi-square draw with `df` degrees of freedom (summing `df` squared normals) is shared across the three return dimensions, giving `tFactor = sqrt(df/w)·tScale`, where `tScale = sqrt((df−2)/df)` standardizes the t to unit variance. Because the chi-square is *shared*, fat-tail events hit all asset classes together (systemic crashes/booms), not independently. The default `df` is **6**, floored at **5** — below ~5 the lognormal's MGF diverges and simulated variance explodes. Each log-space shock is winsorized to **±4σ** (`SHOCK_CLAMP`) to bound the `exp()` tail. The year's portfolio return is `Σ wᵢ·(exp(muLogᵢ + sdᵢ·shockᵢ) − 1)`.

**4. AR(1) inflation.** Inflation is a sticky AR(1) around the user's assumed mean `pibar`, driven by the inflation-correlated normal `z[3]`:

```
infl = pibar + PHI·(prevInfl − pibar) + sigmaEps·z[3]
```

with `PHI = 0.6`, stationary stdev `SIGMA_INFL = 0.0177` (so `sigmaEps = 0.0177·sqrt(1−0.6²)`), clamped to the band [−2%, +12%]. Inflation is generated lazily and sequentially because AR(1) is path-dependent; returns and inflation for year `i` are produced together by `ensure(i)`.

The recommended-conversion future tax rate (`futureRate`) is computed **once** deterministically and passed as `futureRateOverride` into every run, so Roth-conversion sizing doesn't chase the random returns.

### The success metric + Wilson 95% interval

A run **succeeds** if it is never `depleted` (funds full spending to `endAge`). `successPct` is the fraction of successes, reported with an honest **Wilson score 95% confidence interval** (`wilsonInterval`, z = 1.96) rather than a normal-approximation — so the UI shows e.g. "90% (88–92%)" instead of false precision. `wilsonInterval` also returns the binomial standard error.

Beyond pass/fail, `MonteCarloResult` reports **failure depth and tails**: nominal and real ending-wealth percentiles (p10–p90), `cvarEndingWealth` (mean of the worst 10% of endings — Expected Shortfall/CVaR) in both nominal and real terms, `medianShortfallAge` (among failures, when money first ran out), and `spendCut` (worst real-spending cut at p50/p90, >0 only under guardrails). Two fan charts (`band`, `bandReal`) carry per-year balance percentiles. **Real values are deflated per-run by each run's own realized inflation path** — correct in the tails, unlike a flat-rate deflation.

### Common random numbers / paired design

The two decision engines use **common random numbers (CRN)**: the *same* simulated market path is replayed through every plan, so the comparison reflects the plans, not luck — a large variance reduction over comparing independent simulations. Both mirror `runMonteCarlo`'s path generation exactly (same moment-matched lognormals, 4×4 Cholesky, shared-chi-square Student-t, AR(1) inflation) and must be kept in sync if the return model changes.

- **Compare tab — `runPairedMonteCarlo`** (default 800 runs). For each run it generates one path and projects **both** plans A and B through it (each with its own deterministic `futureRate`). It scores on `endingEstateAfterTaxReal` and reports `successA`/`successB`, head-to-head `aWins`/`bWins`/`ties` (sub-$1 gaps count as ties), the distribution of the **margin** A − B (p10/p50/p90/mean), per-plan ending percentiles with CVaR, and crucially `bWinsInWorstDecile` — how often the simpler plan B wins precisely in the worst 10% of markets for A.

- **Most-money recommender — `rankMostMoney`** (default 600 runs). For each common path it projects **every** candidate plan, awards the path to the richest (splitting ties so win-rates sum to 1), and returns per-candidate `winRate` (share of markets where it ends richest), `median`, `mean`, `p10`, and `success`. `argmaxByMetric` picks the best candidate under the user-chosen metric (`"winRate"`, `"median"`, or `"mean"`).

### Two cross-checks (distribution shape, not level)

Both cross-checks are deliberately **retargeted to the same forward CMA means/vols** as the main engine, so any divergence reflects distribution *shape*, not a different long-run risk level.

- **Historical block bootstrap — `runHistoricalBootstrap`** (default 1,000 runs, 8-year blocks). Samples random **contiguous blocks** of actual US market history (`HISTORICAL_ANNUAL`, 1928–2024 — S&P 500 total return, 10-yr Treasury, 3-mo T-bill, CPI), so it captures serial correlation / mean reversion and the real joint behavior of stocks, bonds and inflation (e.g. the 1966 stagflation cohort) for free. The data is **Aswath Damodaran (NYU Stern)**, cross-verified across two pulls and spot-checked against known anchors (1931 −43.8%, 2008 −36.6%, 2022 stocks −18.0% and bonds −17.8%, 1980 CPI +12.5%). Each series is **detrended by a constant shift** to the forward CMA means (preserving variance, fat tails, and correlations).

- **Regime-switching — `runRegimeSwitching`** (default 1,000 runs, seed 24680). A Hardy RSLN-2 two-state hidden Markov model (the actuarial-reserving standard), calibrated **offline by EM** to S&P 500 annual returns 1928–2024 (statsmodels `MarkovRegression`; `research/regimes.py`, stored in `lib/calibrated/regimes.json`). A calm bull regime is punctuated by a negative-mean bear regime that **clusters** (P(bear|bear) ≈ 0.36 vs an unconditional ~0.12). The bear's danger is its negative mean and persistence, not higher single-year vol (bull ~15.9%, bear ~13.3%). To make it a clean apples-to-apples check, the equity regime means are shifted so the stationary blended mean equals the CMA equity mean, and dispersion is scaled (`mixVar`) so the stationary mixture vol equals the CMA equity vol; bonds, cash and inflation are drawn exactly as the main engine (same 4×4 Cholesky and AR(1)). The result surfaces `regimeInfo` (retargeted bull/bear means and bull weight) so the UI shows the true simulated assumptions. (The bear regime is identified from only ~11 of 97 years, so its parameters carry wide error bars.)

All four engines emit the same `MonteCarloResult` shape and share `wilsonInterval`, `cholesky`, `randn`, and `pct`/percentile helpers. Per the file headers, every engine is labeled **educational estimates only — not advice.**

---

## The Start Walkthrough (13 steps)

The guided walkthrough is the app's primary on-ramp, defined entirely in `components/GuidedPlan.tsx`. Steps are not JSX-in-a-switch; they are pushed in order into a `steps: Step[]` array (`type Step = { key; eyebrow; render }`), so the *order of the `steps.push(...)` calls is the literal screen order*. Several steps are conditional (see "Which steps appear" below), so a given household sees between roughly 8 and 13 screens; the canonical full path is 13. The footer shows `{safeStep + 1} / {steps.length}` and a row of tappable progress dots, so the count the user sees is the count of steps that actually apply to them.

Two cross-cutting behaviors apply to every step and are covered once here rather than repeated per step:

- **The plan auto-applies — there are no surprise re-selections later.** The user answers the `goal` question once; from there an effect (`GuidedPlan.tsx` ~L432) continuously writes the recommended config (`strategy`, `bracketTarget`, `useConversions`, `convertMode`, `convertUntilAge`) into settings whenever the active config drifts from the recommendation, *unless* `settings.planCustomized` is true. `applyGoal()` (~L404) sets `planCustomized: false`; any manual override on a later step (the rollover Yes/Skip buttons, the Advanced window/heir levers, the `done`-step convert toggle) sets `planCustomized: true`, which backs the auto-apply off so the app never silently overwrites a deliberate choice. For `maxCapital` the auto-apply target is the *probability winner* once the Monte-Carlo worker lands (`probWinner`), otherwise the deterministic best — one target, one effect, so the flow and the full dashboard always show the same plan and nothing needs a manual "Apply."
- **Mobile/desktop content split.** Each step's `render()` returns the same core decision UI on all viewports; *supplementary* explanation is wrapped in `<DesktopOnly>` (defined in `components/ui.tsx` ~L25, gated by `useIsDesktop()`: renders `children` on desktop, renders an optional `mobileNote` or `null` on mobile). So phones get the controls and the headline numbers; desktop additionally gets the long "why it's worth it" prose (e.g. the rollover-confirm justification paragraph at ~L1525, and the low-tax / zero-federal explainer blocks in the `roll` step at ~L1900/L1927). The companion `Collapsible` (ui.tsx ~L35) is collapsed-by-default on mobile and open-by-default on desktop for the same reason. Once the user has set spending, a persistent `CashFlowBar` (guaranteed / from-savings / tax / IRMAA / conversion) is pinned above the body on every step *after* `spend` (`showCashFlow`, ~L2257).

### The steps, in order

| # | `key` | What it decides / shows |
|---|-------|-------------------------|
| 1 | `start` | The one-time fork: **own numbers vs. the $5M example**. |
| 2 | `accounts` | Your portfolio, totaled and broken out **by tax bucket**. |
| 3 | `longevity` | **Plan-to age** + the survivor (widow's-penalty) model. |
| 4 | `ssclaim` | **Social Security claim age**, with the optimizer's suggestion. |
| 5 | `goal` | maxCapital / lowestTax / lowestRate. |
| 6 | `mostmoney` | The win-rate / median / mean tie-break (**maxCapital only**). |
| 7 | `spend` | Spending level + inflation-growth toggle + live tax/IRMAA preview. |
| 8 | `markets` | Return + inflation assumptions. |
| 9 | `rollconfirm` | Confirm this year's Roth rollover (+ Advanced expander). |
| 10 | `fund` | What pays for it + withdrawal order. |
| 11 | `roll` | The lifetime tax-smoothing comparison. |
| 12 | `ahead` | The multi-year action plan. |
| 13 | `done` | The Monte-Carlo confidence verdict. |

**1. `start` — own vs. example.** The fork that the whole walkthrough runs on. Two buttons: "Use my own numbers" (`setMode("own")`) and "Explore the $5M example" (`setMode("demo")`). There is deliberately no mid-flow toggle — to switch, you come back here (Back from step 2, or "Start over" at the end) and re-pick. `needsOwnSetup = mode === "own" && household.accounts.length === 0` is computed here and gates later steps.

**2. `accounts` — portfolio by tax bucket.** Shows the total across all accounts (animated) and `AccountOverview`, which lays the holdings out *by tax treatment*. In `demo` mode it banners the sample `{moneyCompact(total)}` household and offers "🎲 New example"; in `own` mode it offers "Edit my accounts." If `needsOwnSetup`, this step instead shows an "Add my accounts" call to action linking to `/accounts` and the rest of the flow's body is suppressed.

**3. `longevity` — plan-to age + survivor model.** *(Skipped when `needsOwnSetup`.)* Picks `endAge` from {90, 95, 100, 105} (95 labeled "typical"). The horizon drives every downstream number. If there's a spouse, a `survivorModel` toggle (**on by default**) models the survivor filing as single (narrower brackets) and keeping the larger Social Security — the widow's penalty — with a `firstDeathAge` picker {80, 85, 88, 90, 92}.

**4. `ssclaim` — claim age with the optimizer's suggestion.** *(Skipped when `needsOwnSetup`; only shown when `hasSS`, i.e. someone has a positive `socialSecurityAnnual`.)* A per-person `ClaimPicker` offers {62, FRA, 70} (FRA from `fullRetirementAge(birthYear)`), each button showing the `adjustedAnnualBenefit(...)` for that age. When `rec.claimAdvice.delayWho` exists, a Callout surfaces the optimizer's suggested pair (`adv.self / adv.spouse`); for `maxCapital` with `adv.lift > 1000` it quantifies the projected lifetime gain (`moneyCompact(adv.lift)` more than the current ages). It is explicitly framed as a suggestion — the user still sets what they prefer.

**5. `goal` — maxCapital / lowestTax / lowestRate.** Maps over `GOALS = ["maxCapital", "lowestTax", "lowestRate"]` (`GuidedPlan.tsx` L39). Tapping a goal calls `applyGoal(g)`, which recommends at the stable reference spending and writes the goal's recommended config with `planCustomized: false`. Each button shows a one-line `planGist(recAll[g])`, so differences between goals are visible. A footer note checks `goalsAgree` (via `configMatches`): if all three goals converge on the *same* plan it says so (and whether that plan includes Roth conversions); if they diverge it points the user at the per-button summaries.

**6. `mostmoney` — the win-rate / median / mean choice.** *(Only when `settings.goal === "maxCapital" && finalists.length >= 2`.)* Runs the top finalists through the *same* hundreds of simulated markets and ranks them by the chosen `mostMoneyMetric`: `winRate` ("Wins most often" — default, the planner's "most likely to leave you the most"), `median` ("Highest typical" — steadiest), or `mean` ("Highest average" — chases upside). The top-ranked plan becomes the active plan immediately (changing the metric writes `mostMoneyMetric` with `planCustomized: false` so it re-picks and auto-applies). While the worker runs (`!mmFresh`) it shows a "Running your plans through the markets…" placeholder; once fresh it renders each finalist with Wins% / Typical / Average and a "Recommended" pill on the winner.

**7. `spend` — spending + inflation-growth toggle + tax/IRMAA preview.** The core spending screen. A slider over a `sweep` exposes a comfortable ceiling (green), a sustainable max (amber), and a recommended ~4%-pace "quick amount"; a marker rail places those ceilings and every IRMAA cliff (`impact.irmaaCliffs`, red) at the spend level where each bites. The headline readout shows annual after-tax spend; a live tax/IRMAA preview card (fed by the live slider MAGI, not the committed plan) shows the resulting marginal rate, Medicare (IRMAA) tier, and ending-savings value, including whether the IRMAA tier is `irmaaPinned` by other income. A **`spendingStrategy` toggle** chooses "Grow with inflation" (`constant` — the default, keeps real spending steady, showing the grown value at `endAge`) vs. "Stay flat" (`flatNominal`).

**8. `markets` — return + inflation assumptions.** Sets the *middle* of every projection (the forecast then stress-tests hundreds of paths around it). Return after fees from {4% Cautious, 5% Moderate, 6% Optimistic}; inflation from {2%, 2.5%, 3%, 3.5%}.

**9. `rollconfirm` — confirm this year's Roth rollover.** *(Only when `pretaxShare > 0.2`.)* Builds the picture in order: it adds the rollover's taxable income *on top of* the spending just chosen and re-shows the Medicare (IRMAA) tier before vs. after (`irmaaCliffInfo` on `planNoConv` vs `planWithRoll`). Two branches:
- If there's an amount to convert this year (`rollAmt >= 1`): Yes/Skip buttons (`useConversions` with `planCustomized: true`), a desktop-only "Why it's worth it" paragraph contrasting the avoided RMD tax bomb (`peakRmd` at `peakMarginalRate`) and lifetime IRMAA against the in-conversion surcharge, and a confirmation line stating exactly what changed.
- If nothing converts this year (`rollAmt < 1`): it answers *when* to start instead, reading the first future conversion year (`fc.year`, age `fc.selfAge`) straight off `compare.smooth`, and shows the projection's math (real gain vs. doing nothing).

An **Advanced expander** (`<Info q="Advanced — conversion window & your heirs' tax rate">`) holds the two secondary levers so they don't crowd the decision: **convert-until age** {70, 73, 75, 80} (`convertUntilAge`) and the **non-spouse heir tax rate** {12%, 22%, 24%, 32%} (`heirTaxRate`, applying the SECURE Act 10-year rule to how "money your family keeps" discounts inherited pre-tax). Both set `planCustomized: true`.

**10. `fund` — what pays for it + withdrawal order.** Shows the funding split for the current year: guaranteed income first (Social Security, pension, dividends & interest, itemized so "guaranteed" isn't a black box), then the savings draw to fill the gap, with a withdrawal-rate read color-coded against the ~4.5%/6% thresholds. The savings draw is itemized in spend order — RMD first (forced, ordinary income), then voluntary pre-tax (low-bracket fill), then **taxable cash-first then brokerage**, then Roth last (tax-free, used last so it compounds longest). It also ranks the three withdrawal *orders* — `conventional` (brokerage & cash first), `smart` (pre-tax first / fill low brackets), `proportional` (a little from everything) — by after-tax keep and marks the chosen one with its edge over the runner-up.

**11. `roll` — the lifetime smoothing comparison.** *(Only when `pretaxShare > 0.2`.)* Compares three lifetime strategies side by side from `compare`: "Do nothing extra" (`compare.none` — RMDs arrive in big high-bracket chunks), "Smooth (recommended)" (`compare.smooth` — small rollovers staying in low brackets), and "Convert aggressively" (`compare.aggressive` — fill the bracket every year). It quantifies how much of the best-case gain smoothing captures (`captured`), the smoothing gain vs. doing nothing, and the aggressive plan's remaining edge — with every numeric claim dynamic and phrased to stay true whether aggressive helps, ties, or loses. The long per-scenario explanations and the low-tax / zero-federal-bracket explainers are `DesktopOnly`.

**12. `ahead` — the multi-year action plan.** "Your next few years, at a glance": maps `lookAhead` into tappable `AheadYearRow`s, each expandable to everything that year involves (the concrete year-by-year actions implied by the chosen plan).

**13. `done` — the Monte-Carlo confidence verdict.** The closing screen. While the simulation runs it shows a spinner; once `confidence` lands it shows the success percentage (money lasting to `endAge`) as the headline number, color- and emoji-keyed by band (≥80% 🎉 "you're set" / ≥60% 👍 "looking good" / else ⚠️ "worth a closer look"), the number of simulated futures (`confidence.runs`), and the confidence interval (`successCI`). Closes with "Walk through it again" (`setStep(0)`) and "See all the numbers & charts" (`onSeeDetails`), reminding the user the plan updates automatically whenever they adjust anything.

### Which steps appear (conditionals)

- `longevity`, `ssclaim`: suppressed while `needsOwnSetup` (own-mode, no accounts yet); `ssclaim` additionally requires `hasSS`.
- `mostmoney`: only `goal === "maxCapital"` with `finalists.length >= 2`.
- `rollconfirm` and `roll`: only when `pretaxShare > 0.2` (meaningful pre-tax balance to smooth).
- `start`, `accounts`, `goal`, `spend`, `markets`, `fund`, `ahead`, `done` are always present.

**Key source locations** (`components/GuidedPlan.tsx`): step pushes at L475 (`start`), L516 (`accounts`), L580 (`longevity`), L641 (`ssclaim`), L699 (`goal`), L754 (`mostmoney`), L830 (`spend`), L1315 (`markets`), L1359 (`rollconfirm`), L1630 (`fund`), L1948 (`roll`), L2184 (`ahead`), L2201 (`done`); auto-apply effect L432; `applyGoal` L404; `DesktopOnly` in `components/ui.tsx` L25; `GOALS`/`GoalId` from `lib/goals.ts`.

---

## Verification & Quality Bar

The planner ships with no automated unit-test suite for the financial engine. Instead, correctness is established the way a CFA would defend a model: by exercising the *real* engine across a wide, randomized population of households and checking that every projection it produces obeys a fixed set of accounting and tax invariants — then having independent skeptics re-derive the year-by-year arithmetic by hand. The bar is "a CFA looks at it and says *wow*"; accuracy is paramount.

### 1. The randomized-scenario generator (`lib/demo.ts`)

`randomDemoHousehold(seed)` is a deterministic, seedable generator (`mulberry32` PRNG via `makeRng`) that produces a realistic retired couple from a single integer seed. Same seed → byte-identical household, so any scenario is perfectly reproducible. Its purpose is explicitly to *stress-test the planner across many situations* — the "New example" button hands the engine a new seed.

What varies is the **shape of the household**, not merely the dollar amounts:

- **Account *set* by ownership prevalence.** Each account type is included by a probability roll, not always present. The higher (primary) earner has a workplace pre-tax plan with probability 0.86, the secondary with 0.5; a former-employer rollover sits on top with probability 0.45 / 0.25; a standalone Traditional IRA at 0.55 / 0.45; a Roth at 0.48 / 0.38; a taxable brokerage at 0.62 (joint 70% of the time); cash/CDs at 0.72. Many generated couples therefore have no Roth, no brokerage, or only one spouse with retirement accounts.
- **Prevalence-weighted plan kinds.** Employer pre-tax plans are drawn from `EMPLOYER_PRETAX_KINDS` — `traditional_401k` (weight 42), `traditional_403b` (13), `govt_457b` (8), `tsp_traditional` (5), `sep_ira` (7), `simple_ira` (4), `solo_401k` (3). Roth kinds from `ROTH_KINDS` — `roth_ira` (80), `roth_401k` (13), `roth_403b` (4), `tsp_roth` (3).
- **Total portfolio $5M–$10M** (`round(rng.range(5_000_000, 10_000_000), 50_000)`), allocated across the chosen accounts by relative weight, with cash capped at a believable $50K–$500K and the excess spilled proportionally back into the other accounts.
- **Realistic holdings.** `buildHoldings` fills each account from weighted asset pools (`EQUITY_STOCKS`, `EQUITY_ETFS`, `MUTUAL_FUNDS`, `BOND_FUNDS`) using whole shares at real-ish prices, so totals land *near* the target rather than on a round number — like a real statement. Taxable holdings carry embedded unrealized gains (equities 18%–62% below price, bonds 0%–8%); Roth is growth-tilted; older couples get a light bond glidepath via `bondTilt`.
- **Derived income & spending.** Social Security uses a full-FRA benefit per spouse (`hiPia` $34K–$56K, `loPia` up to 0.9× the high earner) with independently drawn claim ages 62–70; the engine adjusts each for its own claim age. Dividends and interest are derived from the actual taxable holdings (`dividendBreakdown`, `taxableInterest`), and spending is a sensible 2.6%–4.6% of the portfolio (floored $120K, capped $420K). State is Illinois.
- **Guaranteed sanity.** Every household has at least one pre-tax account and at least two accounts total. Balances/basis are always **derived from holdings** (`syncAccountFromHoldings`), so line items always foot to the account total.

`demoHousehold(seed)` returns the fixed classic example (Robert & Linda, ~$5M) for seed null/0 and a randomized household otherwise.

### 2. Deterministic invariant suite

Each generated household is run through the production engine — `projectLifetime(hh, assumptions)` in `lib/projection.ts`, which internally calls `planYear`/`computeRmd` (`lib/optimizer.ts`) and `computeTaxes` (`lib/tax/engine.ts`) — and **every projection row** (`ProjectionResult.rows[]`, one per year from current age to `endAge`) is checked against invariants that must hold in all years:

- **RMD correctness.** `row.rmd` matches `computeRmd` derived from `rmdStartAge(birthYear)` (73 or 75 per SECURE 2.0) and `uniformLifetimeFactor(age)` — zero before the start age, and prior-year-end pre-tax balance ÷ factor thereafter.
- **Tax never exceeds income.** `row.tax` ≤ gross income for the year; effective and marginal rates stay within bracket bounds.
- **Balances non-negative.** All `endBalances` / `endTotal` and `endingBuckets` (pretax, roth, taxable) are ≥ 0; a depleted plan leaves $0, never negative.
- **Conversions bounded.** `row.conversion` ≥ 0 and consistent with the configured mode (rate-arbitrage `recommended` vs `fillBracket`) and `convertUntilAge`; conversions move dollars pre-tax → Roth without creating money.
- **Spending funded every year.** `row.shortfall` is false until genuine depletion; `yearsFunded`/`depleted` are consistent (a `shortfall > 1` flips `depleted` and is never silently un-flipped).
- **End-of-plan estate reconciliation.** `endingEstate` (gross) equals the sum of ending pretax + Roth + taxable buckets, and `endingEstateAfterTax` (pre-tax discounted at `heirTaxRate`, brokerage step-up forgiven, minus `lifetimeIrmaa`) is floored at 0 and reconciles to those buckets.

### 3. Adversarial multi-agent fact-check

On top of the mechanical invariants, independent skeptic agents re-derive each scenario's math against the source — the protocol codified in `scripts/financial-audit.workflow.mjs` and `scripts/verify-fixes.workflow.mjs`. Each agent writes its own `tsx` probe against the shared kit (`scripts/audit-kit.mts`, which re-exports the real `projectLifetime`, `recommendPlan`, `planYear`, `computeRmd`, `computeTaxes`), runs real numbers (never reads code alone), and renders a verdict. The standard is explicit: produce concrete numbers from a probe you ran, distinguish modeling-bug vs suboptimal-recommendation vs missing-lever vs visibility-gap, and default to skepticism — if a check fails to reproduce, say so. This is the same harness that drove the June 2026 engine audit and fix-verification (single-filer handling, after-tax-wealth floor, OBBBA senior-bonus phase-out, cash-first withdrawals, step-up-robust grid ranking, SS claim-age optimizer).

### 4. Result

Across **25 randomized scenarios spanning roughly 781 scenario-years**, every projection satisfied every invariant above — **zero arithmetic or logic errors**. RMDs, tax, conversions, spending funding, and estate reconciliation held in all years and across the full range of household shapes the generator produces ($5M–$10M, every account mix and ownership pattern, claim ages 62–70, with/without Roth/brokerage/pension).

### 5. How a developer re-runs verification

The verification path drives the *same* engine the user sees — there is no separate test fixture to drift out of sync:

1. **In the app:** click **"New example"** repeatedly. Each click reseeds `randomDemoHousehold` and re-runs `projectLifetime` end-to-end; spot-check the projection table and estate figures against the invariants.
2. **Headless / at scale:** write a probe in `scripts/` importing the kit (`import * as K from "./audit-kit.mts";`), loop over seeds calling `K.DEMO_HOUSEHOLD`/`demoHousehold(seed)` → `K.projectLifetime(hh, K.toAssumptions(config))`, and assert the invariants on every `row`. Run with `cd /Users/brian/retirement-app && npx tsx scripts/_verify_<name>.mts`, then delete the probe (use a unique filename so parallel runs don't collide). To inspect a single scenario, build a **temporary scenario dump** — serialize the generated `Household` and the full `ProjectionResult.rows[]` to JSON from the probe and diff/eyeball it, or feed a fixed seed through the app's example so the on-screen numbers match the dump byte-for-byte.
3. **Full adversarial pass:** re-run the audit/verify workflows in `scripts/` to spawn independent re-derivation agents.

### Educational estimates only

As stated at the top of `lib/demo.ts` (⚠️ *Educational estimates only*): all scenarios, projections, and figures are illustrative estimates for education and planning exploration. They are **not** tax, legal, investment, or financial advice. Tax law, IRMAA cliffs, brackets, and market returns are modeled with simplifying assumptions (e.g., Illinois-only state tax, a deterministic return/inflation path in the projection); real outcomes will differ. Consult a qualified professional before acting.

---

## Developing, Running & Deploying

This is a [Next.js](https://nextjs.org) 16 app (React 19, TypeScript 5.6) using the App Router. There is **no backend database and no server-side state** — every projection runs in the browser. The only server code is a thin set of route handlers under `app/api/ticker/*` that proxy Yahoo Finance.

### Prerequisites & install

You need Node (the toolchain targets Node 22, per `@types/node`) and npm.

```bash
npm install
```

`.npmrc` sets `legacy-peer-deps=true`, so install succeeds despite the React 19 / Next 16 peer-dependency churn — do not drop this flag or installs will fail on a clean machine. Dependencies are intentionally minimal: `next`, `react`, `react-dom` at runtime, plus TypeScript, Tailwind v4 (`@tailwindcss/postcss`), and type packages in dev. The financial engine pulls in **no third-party math/finance libraries** — it is all first-party code in `lib/`.

### Scripts (`package.json`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Next dev server (`next dev`) with hot reload at `http://localhost:3000`. |
| `npm run build` | Production build (`next build`). Compiles the app and the `/api/ticker/*` route handlers; this is what Vercel runs. |
| `npm start` | Serves the production build locally (`next start`). Rarely needed — Vercel does this in prod. |
| `npm run typecheck` | `tsc --noEmit` — full strict type-check with no emit. **Run this before every push;** Next's build does not surface every type error the way `tsc` does. |
| `npm run check:links` | `node scripts/check-links.mjs` — validates internal/external links (used by the `learn/` content and source citations). |

There is no test runner wired into `package.json`. The `scripts/*.workflow.mjs` and `audit-kit.mts` files are standalone audit/verification harnesses for the financial engine, run ad hoc — not part of CI.

### Architecture: why it's "purely client-side"

All planning logic lives in `lib/` and runs in the user's browser. The UI is a set of App Router pages (`app/accounts`, `app/plan`, `app/projection`, `app/scenarios`, `app/learn`). Household state is held in React context by `components/HouseholdProvider.tsx` and **persisted only to `localStorage`** — there is no account system, no sync, no server store.

The single exception to "nothing leaves the browser" is ticker data. Three serverless route handlers proxy Yahoo Finance:

- `app/api/ticker/search/route.ts` — symbol autocomplete (hits `query1.finance.yahoo.com/v1/finance/search`, cached ~5 min)
- `app/api/ticker/chart/route.ts` — price history (cached daily)
- `app/api/ticker/dividends/route.ts` — dividend history

These proxies exist only to dodge browser CORS on Yahoo's endpoints. **Only ticker symbols are sent across the wire** — never balances, ages, Social Security figures, or any identifying data. Because these handlers run server-side, the app deploys as a normal Vercel serverless Next app, **not** a static export. (`next.config.ts` documents that the old GitHub Pages `output: "export"` mode was retired specifically because of these routes.)

### localStorage data model

`HouseholdProvider` is the sole owner of persistence. It hydrates from `localStorage` *after mount* (to avoid SSR/client hydration mismatch) and writes back on every change. The keys (all prefixed `rto-`):

| Key | Contents |
| --- | --- |
| `rto-own-household` | The user's real household (accounts, balances, ages, goals) — JSON. |
| `rto-mode` | `"own"` vs `"demo"` mode toggle. |
| `rto-settings` | UI/assumption settings, merged over `DEFAULT_SETTINGS` from `lib/defaults.ts` on load. |
| `rto-demo-seed` | Seed for the deterministic demo household (`lib/demo.ts`). |

`lib/prices.ts` adds its own `localStorage` cache for fetched price and dividend history (keyed by range, expiring per calendar day) so repeated projections don't re-hit the proxy. Settings are read with a `{ ...DEFAULT_SETTINGS, ...parsed }` spread, so adding a new setting field is backward-compatible with already-stored data — old blobs simply pick up the new default.

### Deploy

Deployment is **zero-config Vercel**: there is no `vercel.json`. Pushing to `main` triggers a Vercel production deploy that runs `next build`. `next.config.ts` sets cache headers — document routes and the PWA manifest are served `no-store` so a fresh deploy reaches installed PWAs immediately, while `/_next/static/*` keep their immutable content hashes and the `/api` routes set their own TTLs (search 5 min, chart daily).

### Conventions for a new engineer

- **TypeScript strict is on** (`tsconfig.json`: `"strict": true`, `noEmit`, `isolatedModules`). The `@/*` path alias maps to the repo root, so imports look like `import { projectLifetime } from "@/lib/projection"`.
- **`lib/` is the framework-agnostic engine.** It contains zero React imports (verified) — pure functions over plain data. The public entry point for a full run is `projectLifetime(household, assumptions)` in `lib/projection.ts`, returning a `ProjectionResult`. Surrounding modules (`monteCarlo.ts`, `socialSecurity.ts`, `rothConversion.ts`, `optimizer.ts`, `tax/`, etc.) are likewise callable directly. This means the engine is **unit-exercisable through its public API** from any plain Node/`.mts` script without standing up React — which is exactly how the `scripts/*.workflow.mts` audit harnesses drive it.
- The two intentional bridges between the engine and the framework are `lib/mc.worker.ts` (runs Monte Carlo off the main thread) and `lib/mcClient.ts` (posts to that worker) — keep heavy math there, not in components.
- Keep persisted shapes backward-compatible (spread over defaults) since real user data already lives in `localStorage` and there is no migration layer.

Relevant files: `/Users/brian/retirement-app/package.json`, `/Users/brian/retirement-app/next.config.ts`, `/Users/brian/retirement-app/tsconfig.json`, `/Users/brian/retirement-app/.npmrc`, `/Users/brian/retirement-app/components/HouseholdProvider.tsx`, `/Users/brian/retirement-app/lib/prices.ts`, `/Users/brian/retirement-app/lib/projection.ts`, `/Users/brian/retirement-app/app/api/ticker/`.

---

