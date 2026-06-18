export const meta = {
  name: 'verify-engine-fixes',
  description: 'Independently re-derive each engine fix to confirm it works AND check for regressions',
  phases: [{ title: 'Verify', detail: 'one independent agent per fix, probing the real engine' }],
};

const KIT = `
REPO: /Users/brian/retirement-app  (run from here)
Probe pattern: write scripts/_vf_<name>.mts importing "./audit-kit.mts" as K, run
  cd /Users/brian/retirement-app && npx tsx scripts/_vf_<name>.mts
then delete it. The kit exports: archetypes() (13 households incl. a "Single filer $3M" with spouse.birthYear 1900,
and a "Pre-65 early retiree"), DEFAULT_INPUTS, toAssumptions(config,inputs,over), configSpace(), exhaustiveBest(hh,goal),
shippedBest(hh,goal)=recommendPlan(...), scoreFor, projectLifetime, recommendPlan, planYear, computeTaxes, DEMO_HOUSEHOLD, fmt, pct.
recommendPlan now returns {best,ranked,rationale,chosenConvertUntilAge,claimAdvice}. Be a skeptical CFA: confirm the fix
is REAL with numbers, and explicitly check the stated regression guard. Report verdict + your own evidence.`;

const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    fix: { type: 'string' },
    verdict: { type: 'string', enum: ['works', 'broken', 'partial'] },
    regressionClean: { type: 'boolean', description: 'true if the regression guard held' },
    evidence: { type: 'string', description: 'concrete numbers from your own probe' },
    issues: { type: 'string', description: 'anything wrong, surprising, or worth flagging; "none" if clean' },
  },
  required: ['fix', 'verdict', 'regressionClean', 'evidence', 'issues'],
};

const FIXES = [
  { key: 'single-filer', task: `FIX: a single household (spouse.birthYear<=1900) must file SINGLE for the whole projection and the widow's-penalty transition must NOT run (no 0.8x spending cut, no SS reset). CONFIRM: on the "Single filer $3M" archetype, projectLifetime row0 spendingTarget == entered (120000, not 96000), survivorYear==0, and results are IDENTICAL with survivor on vs off. REGRESSION: the married demo (DEMO_HOUSEHOLD) must be UNCHANGED (survivorYear ~2046, same lifetimeTax/estate as before) — compare married demo with survivor on; it must still transition.` },
  { key: 'displays-floor', task: `FIX: endingEstateAfterTax is floored at 0 (a depleted household must NEVER show negative "after-tax wealth"), and recommendPlan's rationale for a depleted household says "no plan funds your spending..." not a $ amount; the lowestRate rationale reports the actual IRMAA $ (doesn't falsely claim "avoids IRMAA" when lifetimeIrmaa>0). CONFIRM: push an archetype to depletion (e.g. demo at $360k spend) — endingEstateAfterTax>=0 and rationale is the depleted message. Check a solvent lowestRate rec's rationale mentions its real IRMAA. REGRESSION: solvent households' netWealth unchanged (floor is a no-op when positive).` },
  { key: 'senior-bonus', task: `FIX: lib/tax/engine.ts seniorBonusDeduction now phases out the AGGREGATE bonus (6000*num65Plus) once at 6% over the threshold, not per-filer. CONFIRM via computeTaxes for MFJ num65Plus=2, year 2028: at MAGI 250k the bonus should be ~6000 (not 0), at 350k ~0. Compare federal tax in the 200k-350k band before/after conceptually (it should be LOWER now). REGRESSION: single filer (num65Plus=1) unchanged; year>2028 returns 0.` },
  { key: 'cash-first', task: `FIX: taxable withdrawals are cash-first (cash/savings sold before appreciated brokerage) in BOTH the optimizer tax calc (longTermGains = max(0, taxable - cashTaxable)*brokerageGainFraction) and the projection draw. CONFIRM consistency: build a household with large cash + appreciated brokerage; a taxable draw fully covered by cash should realize ~0 LTCG (low/zero cap-gains tax), and the projection's drawn basis matches. Show a household where cash-first saves lifetime tax vs the old pro-rata. REGRESSION: a cash-light household is ~unchanged.` },
  { key: 'grid-robust', task: `FIX: recommendPlan grid now includes proportional, 32% ceiling, and fillBracket, and breaks near-ties (within 2% on full-step-up wealth) toward the most step-up-ROBUST plan. CONFIRM: across archetypes×goals, shippedBest is at/above the old narrow grid and never picks a plan that's much worse than exhaustiveBest on a ROBUST (no-step-up) basis. Specifically on the DEMO maxCapital, the shipped pick should be brokerage-first (conventional) — NOT a proportional plan that only wins via the step-up (its no-step-up estate must not be far below the chosen). REGRESSION: no archetype×goal yields NaN/negative/depleted-when-a-solvent-plan-exists.` },
  { key: 'ss-claim', task: `FIX: recommendPlan returns claimAdvice optimizing self/spouse claim ages, scored by the goal (longevity baked in via endAge). CONFIRM: demo maxCapital recommends delaying the HIGHER earner (self) to 70 with a positive lift (~$250-300k at endAge 95). CRITICAL: at endAge 80 it must NOT recommend delaying (claimAdvice null or earlier) because delaying loses at short horizons; verify the lift grows with endAge (80<85<90<95<100). REGRESSION: a household with no Social Security yields claimAdvice null; light mode (optimizeClaimAge:false) returns null.` },
  { key: 'spending-zones', task: `FIX: spendingSweep now runs on a downside return (2% haircut) so sustainableMax/comfortableMax reflect a weak market. CONFIRM: across archetypes, the sweep's sustainableMax now corresponds to a Monte-Carlo success of roughly 85%+ (use lib/monteCarlo runMonteCarlo with the household's returnModel, ~1500 runs, seed 4242), i.e. materially safer than a median-path ceiling (which would be ~50-75%). Report the MC success at sustainableMax for several households.` },
];

phase('Verify');
const results = await parallel(
  FIXES.map((f) => () =>
    agent(
      `You independently verify ONE fix to a retirement/tax engine. Re-derive it yourself with a tsx probe; don't trust the claim.\n${KIT}\n\nFIX TO VERIFY (${f.key}):\n${f.task}\n\nWrite your probe, run it, read the numbers, and report. Default to skepticism — if the regression guard fails or the fix doesn't reproduce, say so.`,
      { label: `verify:${f.key}`, phase: 'Verify', schema: VERDICT, effort: 'high' },
    ),
  ),
);
return { results: results.filter(Boolean) };
