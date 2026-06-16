# Retirement Tax Optimizer

A mobile-first **PWA** that helps a couple approaching retirement figure out
**which accounts to withdraw from, in what order, to pay as little federal tax
as possible** — across rollover 401(k)s, Traditional IRAs, Roth IRAs, a taxable
brokerage, cash, and Social Security, filing **jointly**.

It models the real, interacting tax rules retirees face: ordinary brackets,
the taxability of Social Security, long-term capital-gains rates, Required
Minimum Distributions (RMDs), the Medicare IRMAA surcharge cliffs, and the Net
Investment Income Tax — using **2026** figures.

> ⚠️ **Educational estimates only — not tax, legal, or investment advice.**
> Federal tax only (no state tax). Verify with a qualified professional.

## What it does

- **This year's plan** (`/plan`) — given your spending target, it picks the
  withdrawal mix (pre-tax → brokerage → Roth) that minimizes tax, always taking
  required RMDs first. Shows a source donut, the full income/tax breakdown,
  effective & marginal rates, SS taxability, capital-gains rate, NIIT, and the
  IRMAA tier. Switch strategies (smart bracket-fill / conventional /
  proportional) and pick the bracket to fill.
- **Opportunities** — actionable, sourced callouts: Roth-conversion headroom in
  low-tax years, 0% capital-gains harvesting, IRMAA-cliff avoidance, QCDs once
  RMD-eligible, the pre-tax "RMD tax bomb," and asset-location tips.
- **Lifetime forecast** (`/projection`) — a 20–30+ year, year-by-year
  projection with **market-return scenarios** (conservative / moderate /
  optimistic), inflation, and horizon controls. Charts the balance of each tax
  bucket over time, the RMD ramp, and **smart vs. conventional lifetime tax**.
- **Key decisions & milestones** — flags the years the strategy has to change:
  the low-tax conversion window, Social Security claim years, RMD start, bracket
  step-ups, when Roth gets tapped, and any shortfall.
- **Learn** (`/learn`) — plain-English explanations of every rule, each with a
  link to the authoritative IRS / SSA / Medicare source.
- **Built-in $5M example** — a ready-made household (~$5M across every account
  type), with each account broken out into realistic **holdings** (stocks,
  ETFs, mutual funds) showing shares, price, value, and cost basis. Your own
  inputs persist on-device (localStorage); nothing is uploaded.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** — light-mode-only theme tokens (deep slate-teal brand, gold
  accent, semantic money colors) as CSS variables via `@theme` in
  [`app/globals.css`](app/globals.css)
- **Dependency-free SVG charts** (donut, stacked area, bars, animated count-ups)
  in [`components/charts.tsx`](components/charts.tsx)
- **PWA** — standalone manifest; deploys to **Vercel** out of the box

## Quick start

```bash
npm install     # .npmrc sets legacy-peer-deps
npm run dev      # http://localhost:3000
npm run build    # production build (all routes static)
npm run typecheck
```

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbtheis15%2Fretirement-app)

## How the engine is organized

| Concern | File |
|---|---|
| 2026 tax constants (brackets, deductions, RMD tables, IRMAA) — **edit yearly here** | [`lib/tax/constants.ts`](lib/tax/constants.ts) |
| Pure federal tax engine (SS taxability, ordinary/cap-gains stacking, NIIT, IRMAA) | [`lib/tax/engine.ts`](lib/tax/engine.ts) |
| Account & household model (the 3 tax buckets + holdings) | [`lib/accounts.ts`](lib/accounts.ts) |
| Withdrawal optimizer (RMDs + bracket-fill solver) | [`lib/optimizer.ts`](lib/optimizer.ts) |
| Multi-year lifetime projection | [`lib/projection.ts`](lib/projection.ts) |
| Decision-point / milestone detector | [`lib/milestones.ts`](lib/milestones.ts) |
| Opportunity detector (sourced callouts) | [`lib/opportunities.ts`](lib/opportunities.ts) |
| Citation registry (IRS/SSA/Medicare) | [`lib/sources.ts`](lib/sources.ts) |
| Built-in $5M example (with holdings) | [`lib/demo.ts`](lib/demo.ts) |

## Key tax facts baked in (2026)

- RMDs apply **only** to pre-tax accounts, starting at age **73** (born
  1951–1959) or **75** (born 1960+) under SECURE 2.0. **Roth IRAs have no
  lifetime RMDs** — a common misconception is that they do; the planner spends
  Roth last for exactly this reason.
- Up to **85%** of Social Security can be taxable based on provisional income.
- Long-term gains/qualified dividends get **0% / 15% / 20%** rates, stacked on
  top of ordinary income.
- The 2025–2028 **senior bonus deduction** and the age-65 additional standard
  deduction are both modeled (with phaseouts).

Update the numbers each year in [`lib/tax/constants.ts`](lib/tax/constants.ts).
