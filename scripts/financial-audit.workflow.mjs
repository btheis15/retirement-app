export const meta = {
  name: 'financial-engine-audit',
  description: 'Advisor-grade audit: sweep all scenarios/levers to find every suboptimal recommendation, modeling bug, and missing financial decision',
  phases: [
    { title: 'Audit', detail: 'parallel domain auditors probe the real engine across household archetypes' },
    { title: 'Verify', detail: 'independently re-derive each material finding to confirm it is real' },
    { title: 'Synthesize', detail: 'rank confirmed findings by dollar impact into a fix plan' },
  ],
};

// Shared orientation given to every agent. The engine is pure TS in lib/, runnable
// headlessly via tsx + the audit kit. Agents MUST produce evidence from the REAL
// engine (numbers from tsx probes), never from reading code alone.
const ENGINE_MAP = `
REPO: /Users/brian/retirement-app  (run everything from here)
This is a retirement/tax-withdrawal optimizer (Next.js front-end, pure-TS engine in lib/, no backend).
The end user is a non-technical retiree; the bar is "a CFA looks at it and says wow". Accuracy is paramount.

HOW TO PROBE (you MUST run real numbers, not just read code):
  1. Write a probe to scripts/_audit_<your-unique-name>.mts that imports the shared kit:
         import * as K from "./audit-kit.mts";
  2. Run:  cd /Users/brian/retirement-app && npx tsx scripts/_audit_<your-unique-name>.mts
  3. Delete your probe when done:  rm -f scripts/_audit_<your-unique-name>.mts
  Use a UNIQUE filename (include your dimension) so parallel auditors don't collide.

SHARED KIT  (scripts/audit-kit.mts) exports:
  - archetypes(): [{label, hh}]  — 13 realistic households spanning the space (sizes, spend levels,
    pre-65 early retiree, single filer, big pension, account-mix variations, ultra-wealthy).
  - DEFAULT_INPUTS = {returnRate:0.05, inflationRate:0.025, endAge:95, convertUntilAge:75,
    survivor:{firstDeathAge:85, spendingFactor:0.8}, heirTaxRate:0.24}  (mirrors DEFAULT_SETTINGS).
  - toAssumptions(config, inputs, over): build ProjectionAssumptions. config = {strategy, bracketTarget,
    conv:bool, convMode:"recommended"|"fillBracket", spendingStrategy?}.
  - configSpace(): full grid (3 strategies x 4 bracketTargets x {none, recommended, fillBracket}) = the
    "true optimum" search space (much larger than the shipped advisor grid).
  - exhaustiveBest(hh, goal, inputs): brute-forces the BEST config in configSpace() for a goal →
    {best:{config,p,score}, all:[...]}. p is a ProjectionResult.
  - shippedBest(hh, goal, inputs): what the ACTUAL advisor (recommendPlan) returns → Recommendation
    {best:{config,metrics,projection}, ranked, rationale}.
  - scoreFor(goal,p), grossIncome(p), fmt(n), pct(n), projectLifetime, recommendPlan, planYear,
    computeRmd, computeTaxes, DEMO_HOUSEHOLD, adjustedAnnualBenefit.

ENGINE API (lib/):
  - lib/goals.ts: recommendPlan(hh, inputs, goal) — the robo-advisor. CONFIGS grid (which configs it
    even considers), score(goal, metrics). GoalId = "maxCapital"|"lowestTax"|"lowestRate".
    NOTE: the grid deliberately EXCLUDES fillBracket conversions and proportional strategy as goal
    candidates (fillBracket is a manual-only override). Question whether that costs the user money.
  - lib/projection.ts: projectLifetime(hh, assumptions) → ProjectionResult {rows[], lifetimeTax,
    lifetimeIrmaa, endingEstate, endingEstateAfterTax (pre-tax discounted at heirTaxRate, brokerage
    step-up forgiven, minus lifetimeIrmaa), endingBuckets, peakRmd, peakMarginalRate, futureRate,
    depleted, totalConverted, survivorYear}. rows[i]={year,selfAge,spouseAge,rmd,fromPretax,fromTaxable,
    fromRoth,conversion,tax,magi,irmaa,marginalRate,effMarginalRate,netCash,spendingTarget,startBalances,
    endTotal,shortfall}. Models: RMDs, Roth conversions (recommended=rate-arbitrage vs futureRate, OR
    fillBracket), survivor/widow transition (single filer, halved brackets, larger SS kept), step-up in
    basis at death, IRMAA (2-yr MAGI lookback), dividend/interest tax drag, Guyton-Klinger guardrails.
  - lib/optimizer.ts: planYear(hh, params) → one year's plan. strategy "smart"=fill low brackets with
    pre-tax first then taxable then roth; "conventional"=taxable(brokerage) first then pre-tax then roth;
    "proportional". Conversion overlay AFTER funding spending. computeRmd(hh, year).
  - lib/tax/engine.ts: computeTaxes(input) → TaxResult {totalTax, federalTax, stateTax, taxableIncome,
    ordinaryTaxableIncome, marginalOrdinaryRate, effectiveMarginalRate, taxableSocialSecurity, magi, niit,
    irmaa{perPerson,householdAnnual,label}, effectiveRate}. ltcgZeroCeiling(status), ordinaryBracketCeiling/Floor.
  - lib/tax/constants.ts: 2026 brackets (MFJ & Single), IRMAA_TIERS_MFJ/SINGLE (cliffs at MAGI 218k/274k/
    342k/410k/750k MFJ), std deductions, senior bonus (OBBBA 2025-28), SS thresholds, NIIT, rmdStartAge(birthYear)
    (73 or 75 per SECURE 2.0), uniformLifetimeFactor(age).
  - lib/socialSecurity.ts: adjustedAnnualBenefit(piaAnnual, birthYear, claimAge) — early-claim reduction /
    delayed-retirement credits. fullRetirementAge(birthYear).
  - lib/spendingSweep.ts, lib/spendingSolver.ts (sustainable-spend bisection on Monte-Carlo success),
    lib/monteCarlo.ts, lib/returnsRegime.ts, lib/returns.ts (CMAs), lib/mortality.ts (Gompertz).
  - State: Illinois only (exempts retirement income & Roth conversions from state tax; flat 4.95%).

KNOWN already-found gap (DON'T just re-report it — build on it): the shipped grid omitted
"conventional + conversions" (brokerage-first spending frees low-bracket room for cheap conversions);
adding it gained +$160k on the demo. It has now been ADDED to CONFIGS. Your job is to find what's STILL
wrong or missing.

EVIDENCE STANDARD: every finding needs concrete numbers from a probe you ran, across SEVERAL archetypes,
with a dollar magnitude. Distinguish (a) suboptimal-recommendation (advisor picks worse than achievable),
(b) modeling-bug (the math is wrong vs ground truth), (c) missing-lever (a real financial decision the
engine doesn't model at all), (d) visibility-gap (modeled but hidden from the user). Be a skeptical CFA.
`;

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: 'one-paragraph headline of what you found' },
    probesRun: { type: 'string', description: 'what you actually ran + key raw numbers' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['suboptimal-recommendation', 'modeling-bug', 'missing-lever', 'visibility-gap', 'correct-no-action'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          description: { type: 'string' },
          evidence: { type: 'string', description: 'concrete numbers from your probe across archetypes' },
          dollarImpact: { type: 'string', description: 'magnitude + which households; "$X on demo, up to $Y on large estates"' },
          affectedHouseholds: { type: 'string' },
          proposedFix: { type: 'string', description: 'specific code change + file' },
        },
        required: ['title', 'kind', 'severity', 'description', 'evidence', 'dollarImpact', 'proposedFix'],
      },
    },
  },
  required: ['dimension', 'summary', 'probesRun', 'findings'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partial'] },
    correctedImpact: { type: 'string', description: 'your independent dollar estimate (may differ from the claim)' },
    reasoning: { type: 'string' },
    independentEvidence: { type: 'string', description: 'numbers from YOUR own probe, written fresh' },
    recommendation: { type: 'string', enum: ['fix-now', 'fix-later', 'wontfix-by-design', 'not-a-bug'] },
  },
  required: ['title', 'verdict', 'reasoning', 'independentEvidence', 'recommendation'],
};

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overallAssessment: { type: 'string' },
    prioritizedFixes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rank: { type: 'number' },
          title: { type: 'string' },
          kind: { type: 'string' },
          rationale: { type: 'string' },
          dollarImpact: { type: 'string' },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          files: { type: 'string' },
        },
        required: ['rank', 'title', 'kind', 'rationale', 'dollarImpact', 'effort', 'files'],
      },
    },
  },
  required: ['overallAssessment', 'prioritizedFixes'],
};

// ---- The auditors: each owns one slice of the decision space ----
const AUDITORS = [
  {
    key: 'recommendation-optimality',
    charter: `RECOMMENDATION OPTIMALITY (the big one). For EVERY archetype x EVERY goal, compare shippedBest()
to exhaustiveBest(). Tabulate the dollar gap (and % gap) in the goal's own metric. Where the shipped advisor
trails the true optimum materially (>$15k or >0.5%), characterize WHY (which config wins, which lever the grid
lacks). Specifically test: does proportional ever win materially? Does fillBracket-mode conversion win for
lowestTax/lowestRate (the grid excludes it)? Does the grid's fixed bracketTarget set {12,22,24} miss 32% for
big estates? Propose the minimal grid additions that close the gaps. This generalizes the brokerage finding —
find ALL remaining grid gaps.`,
  },
  {
    key: 'roth-conversion-sizing',
    charter: `ROTH CONVERSION SIZING. Is "recommended" (rate-arbitrage vs futureRate, capped at the comfort
bracket) actually optimal? Sweep fixed OTI/bracket conversion targets and compare lifetime after-tax wealth &
tax. Is futureRate (worst future RMD-era effMarginalRate from a conventional baseline) the right hurdle? Does
convertUntilAge=75 leave value on the table (convert longer/shorter)? Should conversions continue into the
survivor years (single brackets are narrower → converting BEFORE first death is more valuable — is that captured)?
Quantify the best realistic conversion policy vs the shipped one across archetypes.`,
  },
  {
    key: 'irmaa-cliff',
    charter: `IRMAA CLIFF MANAGEMENT. IRMAA is a hard cliff (cross a MAGI threshold by $1 → full surcharge for
BOTH spouses, 2 yrs later). Does any recommended plan cross an IRMAA tier where stopping just below would net
more after-tax? Quantify cases where an IRMAA-aware conversion/withdrawal cap beats the shipped plan. Is IRMAA
ever double-counted or omitted (it's subtracted in endingEstateAfterTax AND scored in lowestRate — check for
double-count)? Check the 2-year MAGI lookback is applied right. Also assess VISIBILITY: where in the user flow
is IRMAA shown vs hidden. Propose IRMAA-aware conversion sizing if it pays.`,
  },
  {
    key: 'social-security-claiming',
    charter: `SOCIAL SECURITY CLAIMING (likely a big MISSING lever). The app takes ssClaimAge as a fixed input
and never RECOMMENDS when to claim. Claiming age is one of the highest-value retirement decisions. Build probes
that vary self/spouse claim ages (62..70) and measure lifetime after-tax wealth & portfolio survivability,
especially with the survivor model (delaying the higher earner boosts the survivor benefit for life). Quantify
the value of optimal vs naive (claim-at-67) claiming across archetypes (single, couple, different longevity).
Decide: should the advisor optimize/recommend claim ages? How big is the prize?`,
  },
  {
    key: 'zero-pct-capgains-harvest',
    charter: `0% CAPITAL-GAINS HARVESTING. In low-ordinary-income years LTCG can be taxed at 0% (MFJ taxable
income under ~$96k). Does the engine ever harvest gains at 0% (sell appreciated brokerage to reset basis tax-free)?
It competes with Roth conversions for the same low-bracket space. Probe households with big embedded brokerage
gains + low-income gap years: quantify the value of 0%-gain harvesting, and whether the optimizer leaves it on
the table. Is this a missing lever worth adding, and how does it trade off vs conversions?`,
  },
  {
    key: 'tax-engine-correctness',
    charter: `TAX ENGINE CORRECTNESS. Validate computeTaxes() against HAND-COMPUTED ground truth for ~8 income
scenarios (mix of ordinary, qualified dividends, LTCG, SS, muni): 2026 MFJ & Single ordinary brackets, standard
deduction + age-65 add-on + OBBBA senior bonus & its phaseout, SS provisional-income taxability worksheet, LTCG
stacking on top of ordinary (0/15/20), NIIT 3.8% over threshold, IRMAA tier lookup, IL flat 4.95% with retirement
exemption. Find any bracket/threshold/stacking/rounding error. Cite the correct figure vs the engine's.`,
  },
  {
    key: 'estate-stepup-fairness',
    charter: `ESTATE / STEP-UP VALUATION FAIRNESS. endingEstateAfterTax = endPretax*(1-heirRate) + endRoth +
endTaxable - lifetimeIrmaa. This single number drives maxCapital strategy selection. Pressure-test it: (1) Is
discounting pre-tax at a FLAT heirRate (24%) right, or should it reflect the heir's actual bracket / the 10-yr
SECURE drawdown? (2) Brokerage gets full step-up (gain forgiven) — does this over-favor strategies that hoard a
gain-laden brokerage? (3) Is subtracting nominal lifetimeIrmaa (not discounted) consistent with the rest? Does
any of this BIAS the strategy ranking in a way that would mislead the user? Quantify how the maxCapital winner
changes under reasonable alternative estate assumptions (heirRate 0/12/24/37, no step-up).`,
  },
  {
    key: 'survivor-widow-penalty',
    charter: `SURVIVOR / WIDOW'S-PENALTY. Verify the survivor transition: at firstDeathAge the older spouse dies,
survivor files SINGLE (≈half-width brackets), keeps the LARGER SS check, inherits pre-tax (RMDs continue on
survivor's age), spends spendingFactor x. Check the math is right (SS kept, brackets, RMD continuation, IRMAA
single tiers). Does it correctly make pre-death conversions more valuable? Test sensitivity to firstDeathAge.
Also: a genuinely SINGLE retiree from the start (no spouse) — does the engine handle it, or does it wrongly assume
MFJ for life? Quantify any error.`,
  },
  {
    key: 'rmd-correctness',
    charter: `RMD CORRECTNESS. Validate computeRmd(): start age 73 vs 75 by birth year (SECURE 2.0), uniform
lifetime table factors per age, both spouses, only pre-tax accounts, balance/factor. Spot-check several ages vs
the IRS Uniform Lifetime Table. Does the projection apply RMDs before voluntary draws and never double-count?
Does the demo (RMDs at 75) behave right? Are RMDs handled correctly in survivor years? Find any factor/age error.`,
  },
  {
    key: 'spending-sustainability',
    charter: `SPENDING SUSTAINABILITY & GUARDRAILS. Does the sustainable-spend solver (spendingSolver.ts) agree
with Monte-Carlo success? Is Guyton-Klinger (guardrails) implemented correctly (modified-withdrawal, capital-
preservation cut, prosperity raise; suspended last ~15yrs)? Does spendingStrategy interact with withdrawal order
/ conversions in a way that changes the recommendation? Does the deterministic projection's "depleted" flag agree
with Monte-Carlo failure? Find inconsistencies between the spend advice and the risk model.`,
  },
  {
    key: 'assumption-robustness',
    charter: `ASSUMPTION ROBUSTNESS / FRAGILITY. Does the recommended plan FLIP under small, reasonable changes to
returnRate (3-7%), inflation (2-4%), endAge/longevity (85-100), heirTaxRate (0-37%)? If the "best" plan swings by
large dollars or flips strategy on a tiny assumption nudge, that fragility should be surfaced (the advice is
presented as certain). Quantify how stable the maxCapital winner is across the assumption grid for several
archetypes. Flag any case where the shipped pick is best only at exactly the default assumptions.`,
  },
  {
    key: 'charitable-qcd-other-levers',
    charter: `MISSING LEVERS: QCD & others. (1) Qualified Charitable Distributions (QCD): for charitably-inclined
RMD-age households, QCDs satisfy RMDs tax-free (up to ~$108k) — not modeled. Quantify the value for a household
that gives. (2) Asset LOCATION: bonds/cash in pre-tax, stocks in taxable (step-up) — the opportunity detector
mentions it but does the optimizer model it? (3) ACA premium-tax-credit MAGI management for the PRE-65 early
retiree archetype (subsidies phase with MAGI) — modeled? (4) NUA on employer stock — edge case. For each, decide
if it's a worth-adding lever and the prize size. Don't boil the ocean — rank by realistic impact.`,
  },
  {
    key: 'state-il-and-edge-consistency',
    charter: `ILLINOIS STATE TAX & EDGE-CASE CONSISTENCY. Verify IL treatment: flat 4.95%, retirement income
(IRA/401k withdrawals, RMDs, conversions, pension, SS) EXEMPT; only investment income (non-qualified div/interest/
gains) taxed. Confirm conversions are state-tax-free in the projection. Probe edge cases: zero-spending, spending
above sustainable (depletion handling), all-Roth household (no taxable events), all-cash, age-95+ tails, a
household already past RMD age. Find any NaN/Infinity/negative-balance/contradictory output. Confirm the engine
degrades gracefully.`,
  },
];

// ===================== PHASE 1: AUDIT (parallel) =====================
phase('Audit');
log(`Auditing the financial engine across ${AUDITORS.length} dimensions x 13 household archetypes…`);

const auditResults = await parallel(
  AUDITORS.map((a) => () =>
    agent(
      `You are a skeptical CFA-level auditor of a retirement/tax optimizer. Find where its advice is WRONG,
SUBOPTIMAL, or MISSING — backed by real numbers.

${ENGINE_MAP}

YOUR DIMENSION: ${a.key}
${a.charter}

Write tsx probes (scripts/_audit_${a.key}.mts importing "./audit-kit.mts"), run them from the repo root, read
the numbers, iterate, then clean up your probe file. Test across the relevant archetypes(), not just the demo.
Report 1-6 of the most important findings, each with concrete dollar evidence and a specific proposed fix. If a
thing is actually CORRECT and needs no action, say so (kind "correct-no-action") — confirming correctness is
valuable too. Be precise and quantitative; a CFA will read this.`,
      { label: `audit:${a.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA, effort: 'high' },
    ),
  ),
);

const auditors = auditResults.filter(Boolean);
const allFindings = auditors.flatMap((r) => (r.findings || []).map((f) => ({ ...f, dimension: r.dimension })));
log(`Collected ${allFindings.length} findings from ${auditors.length} auditors.`);

// Material findings worth independent verification (skip low/info and already-correct).
const material = allFindings.filter(
  (f) =>
    ['critical', 'high', 'medium'].includes(f.severity) &&
    ['suboptimal-recommendation', 'modeling-bug', 'missing-lever'].includes(f.kind),
);
log(`${material.length} material findings → independent adversarial verification.`);

// ===================== PHASE 2: VERIFY (parallel) =====================
phase('Verify');
const verdicts = await parallel(
  material.map((f) => () =>
    agent(
      `You are an INDEPENDENT verifier. Another auditor claims the following about the retirement engine. Do NOT
trust it — re-derive it yourself with your OWN tsx probe and decide if it's real.

${ENGINE_MAP}

CLAIM (dimension ${f.dimension}, severity ${f.severity}, kind ${f.kind}):
TITLE: ${f.title}
DESCRIPTION: ${f.description}
THEIR EVIDENCE: ${f.evidence}
CLAIMED IMPACT: ${f.dollarImpact}
THEIR PROPOSED FIX: ${f.proposedFix}

Write your own probe (scripts/_verify_${(f.title || 'x').replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.mts), run it,
and independently confirm or refute. Check whether the claimed gain is real or an artifact of the model (e.g.
step-up bias, an unrealistic config, double-counting). Give your own corrected dollar magnitude. Clean up your
probe. Default to skepticism: if you can't reproduce a material gain, mark it refuted/partial.`,
      { label: `verify:${(f.title || '').slice(0, 32)}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ),
  ),
);

const verified = verdicts.filter(Boolean);
const confirmed = [];
material.forEach((f, i) => {
  const v = verified.find((x) => x && x.title && (x.title === f.title || (f.title || '').startsWith((x.title || '').slice(0, 20))));
  // align by index as a fallback (parallel preserves order)
  const vv = v || verified[i];
  confirmed.push({ finding: f, verdict: vv || null });
});
const realOnes = confirmed.filter((c) => c.verdict && (c.verdict.verdict === 'confirmed' || c.verdict.verdict === 'partial'));
log(`${realOnes.length}/${material.length} findings survived verification.`);

// ===================== PHASE 3: SYNTHESIZE =====================
phase('Synthesize');
const dossier = realOnes
  .map(
    (c, i) =>
      `${i + 1}. [${c.finding.severity}/${c.finding.kind}] ${c.finding.title}
   dimension: ${c.finding.dimension}
   what: ${c.finding.description}
   claimed impact: ${c.finding.dollarImpact}
   proposed fix: ${c.finding.proposedFix}
   VERDICT: ${c.verdict.verdict} — ${c.verdict.reasoning}
   corrected impact: ${c.verdict.correctedImpact || 'n/a'}  | rec: ${c.verdict.recommendation}`,
  )
  .join('\n\n');

const synth = await agent(
  `You are the lead financial advisor + engineer. Below are independently-VERIFIED findings about a retirement/
tax optimizer (the bar: a CFA says "wow"; the user is a non-technical retiree). Produce a single prioritized fix
plan, ranked by (dollar impact to the user) x (how common the affected household) x (low effort). Group/merge
duplicates. For each fix: rank, title, kind, rationale, dollarImpact, effort (small/medium/large), files to touch.
Be decisive — this is the action plan I will implement.

VERIFIED FINDINGS:
${dossier || '(none survived verification)'}

Also give an overallAssessment: is the engine's advice trustworthy today, and what are the 2-3 changes that
matter most?`,
  { phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' },
);

return {
  auditorCount: auditors.length,
  totalFindings: allFindings.length,
  materialFindings: material.length,
  confirmedCount: realOnes.length,
  synthesis: synth,
  confirmedFindings: realOnes.map((c) => ({
    title: c.finding.title,
    dimension: c.finding.dimension,
    severity: c.finding.severity,
    kind: c.finding.kind,
    description: c.finding.description,
    evidence: c.finding.evidence,
    dollarImpact: c.finding.dollarImpact,
    proposedFix: c.finding.proposedFix,
    verdict: c.verdict.verdict,
    correctedImpact: c.verdict.correctedImpact,
    verifierReasoning: c.verdict.reasoning,
    recommendation: c.verdict.recommendation,
  })),
};
