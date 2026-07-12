# Customer-Experience Improvement Plan

> **How this plan was made (July 2026):** a full walkthrough of the app in the shoes of a
> just-retired, non-technical customer who depends on it to know **what to do, how much to
> spend, how much to set aside for taxes, and what their withdrawals do to IRMAA** — plus a
> code-level trace of the engine-to-advice layer. Every finding below was verified against
> the current source (file:line cited). The bar: a top-tier professional finance app where
> nothing important is missable and every number a customer acts on is right.

---

## STATUS — updated July 12, 2026

The audit below was written against commit `eec87e5`. Two waves of work have since landed
or are in open PRs; line numbers in the body are historical.

**Already fixed before this plan's execution started (PRs #48–#51, merged):**
- 0.1 all-in tax set-aside (headline includes conversion tax, called out separately)
- 0.2 SS catch-22 (the SS step now always appears; benefit entry in-flow)
- 0.3 NIIT/senior-bonus MAGI bug (muni add-back removed; probe suite added)
- 1.1 partially: withholding-vs-quarterly + 1040-ES dates (PaceCard "Right now" dashboard)
- 4.x partially: month-paced dashboard with real deadlines (RMD Dec 31, conversion, 1040-ES)
- DOCS.md regenerated; regression probe suite (`scripts/_audit_*.mts`) established

**Fixed in this execution wave (open PRs, in two independent merge chains):**
- Chain 1 (engine): **#52** 0.4 IRMAA surcharge-dollar indexing + 2.5 tier-crossing
  milestones → **#53** 2.3 IRMAA-cliff-capped conversion sizing (incl. pre-65 billing-year
  enrollees)
- Chain 2 (UI): **#54** 1.3 "Roth conversion" rename + 5-year rule + 0.5 TabBar filing
  status + 1.1 safe-harbor & IL-1040-ES + payment guidance on mobile → **#55** 1.2
  partially: per-spouse RMD amounts w/ Dec-31 deadline + first-year April-1 note → **#56**
  2.1 always-on IRMAA meter (mobile) + 2.2 pre-65 lookahead + 2.4 SSA-44 guidance + a
  sentinel-spouse bug that doubled displayed IRMAA for single households → **#57** 4.1
  plan-aging nudges (new-tax-year + stale-balances banners, freshness tracking) → **#58**
  3.1/3.2 chapter reorder + "Your conversion & taxes" chapter, 3.3 Accounts one-home,
  3.5 persistent example-data pill, 3.6 spouse radio / mostmoney default / honest
  done-step grading (🎉 now ≥85%, was 80; 👍 at 70, was 60)
- Every engine change ships with a hand-mathed probe; the full suite (27 files) is green
  on the integrated chain tip. Merge each chain in order; GitHub retargets stacked PRs
  automatically as predecessors merge.

**Still open (highest value first):**
- 1.2 remainder: a printable "Do this in January" closing checklist step (per-account
  amounts; buildActionPlan is per-person for RMDs now but not per-account)
- 2.4 remainder: optional "MAGI two years ago" input so year-1/2 premiums are real
- 4.2 year-end checklist mode (Oct–Dec: RMD done? conversion executed & re-sized on
  near-final numbers?) — PaceCard's deadlines cover part of this
- 4.3 post-onboarding wayfinding (Plan tab as home base after the walkthrough)
- 3.4 remainder: mobile parity audit of every DesktopOnly (the roll step's personalized
  verdict is still desktop-only)
- P5 polish: type-size floor (13px for decision-relevant), honest time estimate,
  plain-language confidence framing, print stylesheet, Compare reference-spend sentence

**What's already strong (keep, don't touch):** gross-up math is correct — the recommended
withdrawal is gross of tax, so a customer following it won't come up short
(`lib/optimizer.ts:164-183`). The IRMAA 2-year lookback is wired correctly in the projection
(`lib/projection.ts:340,493-496`). IRMAA is surfaced *before* commitment on the spend and
rollover steps with cliff markers, before/after tables, and "billed two years later" copy.
The AdjustLink single-source-of-truth pattern, the Plan tab's "Your move this year" action
framing, and the sourced plain-English explainers are genuinely advisor-grade. This plan
builds on that; it does not rework it.

---

## How to read this plan

- Items are grouped into **phases in priority order**. Each phase is independently shippable
  (matching the established increment style). Engine changes ship separately from UI changes.
- Each item is written as an instruction: **Do → Where → How → Why (customer impact)**.
- P0 = a customer acting on today's app gets a wrong or dangerously incomplete number.
  P1 = the biggest missing capability. P2–P5 = visibility, flow, lifecycle, polish.

---

## Phase P0 — Fix numbers a customer would act on (accuracy first)

### 0.1 The headline tax set-aside must include Roth-conversion tax
- **Do:** Make every "set aside $X for tax" headline the **all-in** number: spending-withdrawal
  tax + conversion tax (+ IRMAA where the copy says "total").
- **Where:**
  - `app/plan/page.tsx:54-57` — the Plan page's `planYear(...)` call passes **no `conversion`**,
    so the "withdraw about $X, set aside roughly $Y for tax" headline (L211) and the "Bottom
    line" (L299-301) omit the tax on the very conversion the same page tells the user to
    execute (L166-177). Meanwhile the first "next few years" card (L1044) shows the projection
    row's tax *including* conversion — two different this-year tax numbers on one page.
  - `components/GuidedPlan.tsx:2492` — the `fund` step's "Set aside about $X for tax" uses
    `planNoConv`; the conversion's tax appears only as a small annotation inside the
    rollconfirm table (L2031), and the true all-in total lives only in a collapsed-by-default
    section on the `breakdown` step (L2857).
- **How:** Source the headline from the same place the action list is sized from
  (`activeProj.rows[0]`, which models the conversion), or pass the active conversion into
  `planYear`. `conversionTax` already exists on `YearPlan` (`lib/optimizer.ts:231-233`).
  Where the pedagogy deliberately shows spending-tax first (the additive build-up), label it
  explicitly: *"…plus ≈$Z more for your conversion — next step."* Never let an unlabeled
  partial number be the last tax figure a customer sees.
- **Why:** A customer confirming a $60k conversion could reserve tens of thousands too little.
  This is the single most trust-critical defect found.

### 0.2 A new "own numbers" user can never enter Social Security (or a pension) in the flow
- **Do:** Add an **unconditional income step** to the Income chapter: "Do you (each) receive —
  or expect — Social Security? What's the monthly amount on your SSA statement? Any pension
  or annuity?" $0 allowed. Seed `ssclaim` from it.
- **Where:** `components/GuidedPlan.tsx:1034` gates `ssclaim` on `hasSS`
  (`socialSecurityAnnual > 0`), but `emptyHousehold()` starts SS at 0
  (`lib/defaults.ts:16-17`) — a catch-22: the only in-flow place to enter SS never appears
  for the very user who needs it. Pension has no step at all (entry only on `/accounts`),
  and the `dividends` step's >$200 gate (L631) has the same problem for simple-bucket users.
- **How:** New step keyed `income` (chapter `income`), always pushed in own mode; per-person
  monthly SS input + pension input. Keep `ssclaim`'s optimizer UI as the follow-on step.
  Note: the `start` step's chapter preview (L649) already *promises* "Income — Social
  Security, and any pension" — today the whole chapter silently vanishes for these users.
- **Why:** Without it, a real new user's plan silently assumes **$0 Social Security for
  life** — spending ceiling, taxes, conversion sizing, and the success % are all materially
  wrong, with no warning.

### 0.3 Fix the NIIT MAGI computation (engine)
- **Do:** Stop adding tax-exempt (muni) interest to MAGI for the **NIIT threshold test** and
  the **OBBBA senior-bonus phaseout**. Keep the add-back for IRMAA MAGI and SS provisional
  income (those are correct).
- **Where:** `lib/tax/engine.ts:214` builds `magi = agi + taxExemptInterest` and uses it at
  L243 (NIIT) and L222 (senior bonus). §1411 MAGI does not add back tax-exempt interest.
  The comment at L213 asserts the wrong rule — fix it too.
- **How:** Two MAGI variants (`magiForIrmaa`, `magiForNiit`/statutory). Add a regression
  test: household at $255k MFJ with $20k muni interest → NIIT applies to $5k over, not $25k.
- **Why:** Overstates tax for muni holders near $250k. Fails the CFA-bulletproof bar.

### 0.4 Index IRMAA surcharge dollars in the long projection (engine)
- **Do:** Inflate the per-tier `monthlyPerPerson` surcharge dollars by the same factor used
  to index the tier thresholds.
- **Where:** `lib/tax/engine.ts:180-190` — `irmaaFor` indexes thresholds but returns 2026
  surcharge dollars for all ~60 projection years.
- **Why:** Understates late-life IRMAA (and `lifetimeIrmaaReal` doubly so), which biases the
  do-nothing path to look cheaper than it is and mildly biases against conversions — a
  ranking input, not just display.

### 0.5 Small correctness/honesty fixes (bundle into one PR)
- `components/TabBar.tsx:52` — "Filing jointly · 2026 rules" is **hardcoded**; render the
  household's actual filing status. Wrong for every single-filer.
- `components/GuidedPlan.tsx:957-960` — `aboutyou` collects a retirement year the projection
  then ignores, disclosed only in an 11px footnote. Either wire it in or move the disclosure
  to full-size text on the step ("we'll model as if retirement starts now").
- `components/GuidedPlan.tsx:1609` — spend step says the rollover is "the next step"; it's
  two steps away.
- `lib/milestones.ts:10` — header comment promises IRMAA-tier-crossing milestones; none are
  implemented. Implement (see 2.5) or fix the comment.
- `DOCS.md` "The Start Walkthrough (14 steps)" describes a flow that no longer exists
  (no chapters, no bucket/dividends/breakdown steps, stale line numbers). Regenerate.

---

## Phase P1 — Build the missing "paying the IRS" layer

*Grep-verified: zero occurrences of withholding / quarterly / estimated tax / safe harbor /
1040-ES / SSA-44 anywhere in the app. The dollar amount is given; the mechanics of paying it
are not. This is the largest capability gap between this app and a professional advisor.*

### 1.1 "How to pay this tax" module
- **Do:** A small, always-visible card directly under every tax set-aside number, generating
  three concrete options from numbers the engine already has:
  1. **Custodian withholding** (the retiree-friendly default): "Ask your custodian to
     withhold **N%** on your pre-tax withdrawals" — N = totalTax ÷ gross pre-tax
     distributions, capped sensibly. Note that withholding is treated by the IRS as paid
     evenly through the year (this is *the* reason it's the clean mechanism, especially in
     conversion years).
  2. **Quarterly estimates**: four 1040-ES amounts with the Apr 15 / Jun 15 / Sep 15 / Jan 15
     dates.
  3. **Safe harbor**: one sentence — pay 100% (110% if AGI > $150k) of *last year's* tax and
     no penalty applies regardless — with an optional "last year's total tax" input. This is
     the highest-value fact in year 1 of retirement, when last year was a working year.
  - Add the IL angle when state tax > 0 (IL-1040-ES), and a one-liner on underpayment
    penalties ("setting the cash aside is not the same as paying it on time").
- **Where:** under `components/GuidedPlan.tsx:2492` (fund step) and
  `app/plan/page.tsx` after L214 (Plan headline). Pure UI + one small pure helper
  (`lib/taxPayment.ts`); no engine change.
- **Conversion-specific line:** the flow already says conversion tax is "best paid from
  cash" (`lib/optimizer.ts:450-454`) but never says how one *pays tax from cash* — answer in
  one sentence: via estimates, or by bumping withholding on other distributions late in the
  year. Add it to `rollconfirm`.

### 1.2 Close the flow with a "Do this in January" checklist
- **Do:** A final actionable step (before or folded into `done`) — the printable artifact a
  professional would hand over: the 3–6 custodian actions for this calendar year.
  - Withdrawal: amount **per named account** (not per bucket), and who to call.
  - RMD: **per person** — each spouse's RMD must come from their own IRA. `rmdDetails`
    already computes this (`lib/optimizer.ts:71-89`) and is currently consumed **nowhere**
    in the UI. Include the Dec 31 deadline (Apr 1 first-year option) and, if charitably
    inclined, the QCD-before-RMD ordering note.
  - Conversion: amount, the word **"conversion"** (see 1.3), suggested timing, and its
    incremental tax.
  - Withholding election or estimate dates (from 1.1).
  - One IRMAA line: "this year's income sets your {year+2} Medicare premium: tier X."
- **Where:** extend `lib/actionPlan.ts` (currently bucket-level, `:87-101`) to per-account/
  per-person actions; render as the new closing step in `GuidedPlan.tsx` and reuse on the
  Plan tab. Make it printable (print stylesheet) — this demographic prints.
- **Why:** the audit's unanimous top question at the end of the current flow: *"OK — but what
  do I literally do in January, and do I withhold or pay quarterly?"* The confidence verdict
  (`done`) answers "will my money last," not "what do I do."

### 1.3 Say "Roth conversion," not "Roth rollover"
- **Do:** Rename throughout (`rollconfirm`, `roll`, CashFlowBar chips, breakdown). First
  mention: "Roth **conversion** (sometimes called a rollover)."
- **Why:** At Fidelity/Schwab, "rollover" means 401(k)→IRA. The customer's very next act is
  to phone a custodian; the app's one nonstandard term sits exactly at the hand-off point.
- **Also:** add one line on the **conversion 5-year rule** to `rollconfirm` (zero mentions
  today). Customers will hear it from their custodian and wonder what else the app missed.

---

## Phase P2 — Make IRMAA impossible to miss

### 2.1 Always-on IRMAA meter on the Plan tab (mobile included)
- **Do:** A compact, calm gauge visible on every Plan-tab visit:
  *"This year's MAGI: $X → Tier N (sets your {year+2} premium) · $Y of headroom below the
  next cliff."* Neutral tone by default; warning state only when close.
- **Where:** the tier math already exists in `lib/opportunities.ts:89-117`, but today it only
  fires within $15k of a cliff and renders inside the **collapsed** "More ways to save"
  expander (`app/plan/page.tsx:347-385`) — framed as a savings tip, not a status readout.
  The IRMAA pill + explainer on Plan are inside `DesktopOnly` (L390-504): **a phone user sees
  no IRMAA status at all** after onboarding. Render the meter unconditionally, outside any
  expander, on both breakpoints. MAGI itself is currently never labeled on any ongoing
  surface — show it here.
- **Why:** the user's own stated requirement — you can't miss what your withdrawals are doing
  to IRMAA. A mid-year extra withdrawal is exactly the moment this must be in view.

### 2.2 Pre-65 lookahead
- **Do:** When nobody is on Medicare yet but anyone is 63+, replace "Not yet — starts at 65"
  with *"Your income **this year** sets your first Medicare premium at 65"* and run the
  cliff readout with prospective enrollees.
- **Where:** `components/GuidedPlan.tsx:1581-1584`; `irmaaCliffInfo` returns `null` when
  enrollees = 0 (L3185).
- **Why:** the 2-year lookback means 63–64-year-olds are already in the window — the exact
  trap the app warns about is disabled for the people entering it.

### 2.3 IRMAA-aware conversion sizing (engine)
- **Do:** When the recommended conversion overshoots an IRMAA threshold and the tier jump
  costs more than the bracket-arbitrage gain on the overshoot, **cap the conversion just
  below the cliff** (and say so: "sized to stay $1 under the Tier-2 line").
- **Where:** `lib/optimizer.ts:479-489` fills to bracket ceilings only;
  `effectiveMarginalRate` deliberately excludes IRMAA (`lib/tax/engine.ts:277-283`). Tier
  bounds are already in `FILING_CONSTANTS`. Today the app warns after the fact but still
  recommends the overshooting number.
- **Why:** a $1 overshoot triggers the full tier surcharge for the household for a year —
  a professional would never size a conversion without checking the cliff.

### 2.4 First-two-years IRMAA honesty + SSA-44
- **Do:** (a) Add an optional "taxable income two years ago (roughly)" input so year-1/2
  premiums reflect reality; (b) wherever year-1/2 IRMAA shows, add the **SSA-44** callout:
  *"Just retired? Your first premium is based on your old working income — you can file Form
  SSA-44 (life-changing event: work stoppage) to have it re-figured on your new income."*
- **Where:** `lib/tax/engine.ts:49-50,312` falls back to same-year MAGI for years without a
  lookback; the input belongs on the new income step (0.2) as an optional expander.
- **Why:** for a brand-new retiree, the app's year-1 premium is systematically wrong (their
  2024 W-2 set it), and the SSA-44 appeal is the single most valuable IRMAA action available
  to them. A professional app both predicts the real bill and hands them the fix.

### 2.5 IRMAA milestones in the Forecast
- **Do:** Emit "first year in a surcharge tier" / "tier jump" / "drops back to base"
  milestones, and add the per-year IRMAA note to the next-few-years cards.
- **Where:** `lib/milestones.ts` (fulfills its own L10 comment); `lib/actionPlan.ts` years.

---

## Phase P3 — Flow order, decision confidence, one-home-per-setting

### 3.1 Assumptions before verdicts: move `markets` before `spend`
- **Where:** chapter order at `components/GuidedPlan.tsx:48-49` (sort at L2961).
- **Why:** today the customer accepts a "Comfortable ✅" spending verdict, then two steps
  later changes the return/inflation assumptions it rested on — and is never routed back.

### 3.2 Give the conversion decision its own chapter
- **Do:** Move `rollconfirm` (and `fund`) out of "Markets & taxes" into a visibly named
  chapter ("Your Roth conversion" / "Paying for it"), or into Review.
- **Why:** the biggest single decision in the flow is currently filed under a label that
  reads as background assumptions. Chapter names are the customer's mental map.

### 3.3 One decision surface per lever
- `components/GuidedPlan.tsx:2310` — `fund` re-surfaces the SS claim-age picker after
  `ssclaim` already settled it. Show the chosen ages read-only with a "change" link instead.
- `app/accounts/page.tsx:129-136,176-178` — raw SS-claim-age and spending inputs bypass all
  the walkthrough's coaching (cliff markers, guardrails) while the Plan tab says "you set
  this in the walkthrough." Replace with read-only value + `AdjustLink step="ssclaim"` /
  `step="spend"` — the app's own pattern, applied to its last two stragglers.
- `app/projection/page.tsx:1119-1126` — LongevityCard silently edits `endAge` outside the
  flow; either badge it as an override or AdjustLink it.

### 3.4 Decision-critical content must exist on mobile
The DesktopOnly split ("mobile = what, desktop = why") is right for *analytics*, wrong for
*justifications the decision depends on*. Minimum moves:
- The `roll` step is **entirely** desktop-only (`GuidedPlan.tsx:2629`) — including the
  personalized "Bottom line for you" verdict and the honest "converting aggressively would
  leave your family $X worse off" warning. Lift the verdict + the compact 3-approach
  comparison out of DesktopOnly; keep the bracket ladder desktop-side.
- The 2-year-lookback explainer on `spend` is desktop-only (L1640); mobile gets one 11px
  line. Move the lookback sentence to always-visible.
- On the Plan tab, the IRMAA pill and effective/marginal-rate stats are decision inputs,
  not analytics — move out of `DesktopOnly` (`app/plan/page.tsx:390-504`). (2.1 subsumes
  the IRMAA part.)
- **Technique:** adopt a rule — *a number or warning may be desktop-enriched, never
  desktop-exclusive, if it changes what the customer would choose.* Audit every
  `DesktopOnly` against it.

### 3.5 Persistent example-data indicator
- **Do:** While `mode === "demo"`, show a slim "📊 Example data" pill in the step chrome /
  CashFlowBar on **every** step, and caveat the final "🎉 96%" verdict ("of the example
  household"). Flag mixed state ("your ages, example's money") when exploratory overrides
  (`EXPLORATORY_KEYS`, `components/HouseholdProvider.tsx:48`) are active.
- **Why:** today the sample banner exists only on step 8; sixteen later steps show demo
  dollars unmarked, and a user can type real birth years/SS/spending into the example and
  reasonably believe the plan is theirs.

### 3.6 Smaller decision-confidence fixes
- Spouse toggle (`GuidedPlan.tsx:906-922`): a highlighted pill stating "I have a
  spouse/partner" that *removes* the spouse when tapped → replace with two radio options
  ("Just me" / "Me + my spouse").
- `mostmoney` step: don't ask a 65-year-old to pick win-rate vs median vs mean — default to
  the recommendation, tuck the estimator picker behind "Advanced."
- `done` step grading: 60–79% success gets a 👍 "looking good" — generous for someone with
  no earning years left. Recalibrate (≥85 🎉 / 70–84 "solid, watch it" / <70 ⚠️ "let's
  adjust") and say what to adjust.
- Brokerage-gains bucket step defaults to "assume no gain" (L746-747) — that *understates*
  sale taxes; say which direction the shortcut errs and nudge toward an estimate.
- Compare tab: one sentence near the "Recommended" pill explaining the reference-spend vs
  actual-spend basis (`app/scenarios/page.tsx:43-51`) so a card outscoring "Recommended"
  doesn't read as a bug.
- State: the app silently assumes IL (`household.state ?? "IL"`); non-IL users selecting
  "none" still see "(federal + Illinois)" plumbing in copy. Ask the state once in `aboutyou`
  and route the copy.

---

## Phase P4 — Make the plan live in time (the ongoing loop)

*Today the plan "ages" only via `new Date().getFullYear()`. There is no concept of staleness,
actuals, or revisit triggers — a customer who finishes onboarding in June gets zero signal
about when to come back.*

### 4.1 Staleness + new-year nudges
- **Do:** Store `lastReviewedAt` and a balances-updated timestamp in settings. Plan tab
  banner when the calendar year rolls ("New tax year — 2 minutes to re-check your plan":
  new constants, new RMD, conversion re-size) or when manually entered balances are >6
  months old.
- **Where:** `components/HouseholdProvider.tsx` settings + a banner on `app/plan/page.tsx`.
  Cheap: no engine change.

### 4.2 Year-end checklist mode
- **Do:** From ~October, surface a "before Dec 31" list: RMD completed? (25% excise-tax risk),
  conversion executed? (and re-size it on near-final year numbers — conversions are sized on
  projected year-end figures today), withholding on track vs the 1.1 module.
- **Why:** the two deadlines that actually burn retirees are both Dec 31.

### 4.3 Post-onboarding wayfinding
- **Do:** After `done`, make the Plan tab the explicit home base — one-time "Your plan lives
  on the Plan tab; come back to Start to change a decision" hand-off, and reframe Start's
  entry for returning users ("Revisit a decision" + the choices recap as the front door).
- **Why:** the tab bar still leads with Start forever; nothing tells a finished user where
  they now live.

---

## Phase P5 — Professional-grade polish

- **Type size for a 65+ audience:** the most consequential disclosures (2-year lookback,
  cost-basis guidance, retirement-year caveat) are set at 10–11px. Establish a floor:
  nothing decision-relevant below ~13px; test at OS large-text settings.
- **Honest time estimate:** "About 5–10 minutes" (L658) vs a 20-step flow with sliders and
  Monte-Carlo waits — say 15–20, or show per-chapter estimates in the roadmap.
- **Confidence framing:** "92% confidence (89–94%)" reads as false precision/anxiety to a
  layperson — plain-language framing ("in 9 of 10 market histories, this plan holds")
  with the CI behind an Info.
- **How IRMAA is billed:** one Learn/breakdown line — it's deducted from the Social Security
  check (or invoiced) — so the first smaller SS deposit isn't a shock.
- **Print/export the plan:** the January checklist (1.2) and the breakdown recap should have
  a clean print stylesheet / "Save as PDF" — the artifact customers bring to their CPA.
- **DOCS.md regeneration** (from 0.5) once P0–P1 land, so the docs match the shipped flow.

---

## Techniques to apply throughout (the standing rules)

1. **One number, one source.** Any figure shown twice must come from the same computation
   (the conversion-tax bug is what happens otherwise). When pedagogy requires showing a
   partial number, label the remainder explicitly on the same screen.
2. **Every dollar figure ends in an action.** "You'll owe $23k" is analysis; "have Fidelity
   withhold 14% on your IRA withdrawals" is advice. Each headline number should answer
   *what do I do about it* within one screen.
3. **Desktop-enriched, never desktop-exclusive, for decision inputs.** The mobile/desktop
   split stays — but anything that would change the customer's choice must exist on the
   phone in at least compact form.
4. **Warnings before commitment, status always.** Cliff/deadline warnings belong on the step
   where the decision is made (already good) *and* as an always-visible status meter
   afterward (the gap). Collapsed expanders are for depth, never for warnings.
5. **Speak the custodian's language.** Every term the customer will repeat on the phone —
   conversion, RMD, withholding, 1040-ES, SSA-44 — must match industry usage exactly.
6. **No dead-end questions.** Never collect an input the engine ignores (retirement year)
   and never gate a step on data only that step can provide (the SS catch-22).
7. **Engine changes ship with probes.** Every P0/P2 engine fix (NIIT MAGI, IRMAA indexing,
   cliff-capped conversions) lands with a verification script in `scripts/` reproducing a
   hand-checked case, per the CFA-bulletproof bar.
8. **State the direction of every shortcut.** Where the model simplifies (no-gain default,
   year-1 IRMAA fallback, fixed-dollar assumptions), say which way the error runs —
   "this likely overstates/understates X" — so trust survives the customer's CPA reading it.

---

## Suggested PR sequence (each shippable, engine/UI separated)

| PR | Contents | Type |
|----|----------|------|
| 1 | 0.1 all-in tax set-aside + 0.5 bundle | UI (uses existing engine fields) |
| 2 | 0.3 NIIT MAGI + 0.4 IRMAA indexing + probes | Engine |
| 3 | 0.2 income step (SS/pension) + 2.4 prior-MAGI input | UI + one engine input |
| 4 | 1.1 how-to-pay-tax module + 1.3 conversion rename + 5-year-rule line | UI |
| 5 | 1.2 January checklist (per-person RMD via `rmdDetails`, per-account amounts) | Engine (actionPlan) + UI |
| 6 | 2.1 IRMAA meter + 2.2 pre-65 lookahead + 2.5 milestones | UI + small engine |
| 7 | 2.3 cliff-capped conversion sizing + probes | Engine |
| 8 | P3 flow fixes (order, chapters, one-home, mobile parity, demo pill) | UI |
| 9 | P4 lifecycle (staleness, year-end mode, wayfinding) | UI |
| 10 | P5 polish + DOCS.md regen | UI/docs |
