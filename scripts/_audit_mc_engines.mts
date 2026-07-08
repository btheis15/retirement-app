/**
 * Audit probe 3 — end-to-end engines on the demo household:
 *  - runMonteCarlo determinism, success criterion, monotone percentile bands
 *  - realized path-level portfolio return vs model.expected
 *  - CRN variance reduction: var(paired diff) vs var(independent diff)
 *  - runPairedMonteCarlo internal consistency (aWins+bWins+ties=1)
 *  - rankMostMoney: winRate sums to 1, success in [0,1]
 *  - cross-engine agreement (parametric vs bootstrap vs regime)
 *  - stress scenarios vs official S&P history; dividend growth compounding
 * Run: npx tsx scripts/_audit_mc_engines.mts
 */
import { DEMO_HOUSEHOLD } from "../lib/demo.ts";
import { returnModel } from "../lib/returns.ts";
import { runMonteCarlo, randn, cholesky } from "../lib/monteCarlo.ts";
import { runPairedMonteCarlo } from "../lib/compareMonteCarlo.ts";
import { rankMostMoney } from "../lib/recommendMonteCarlo.ts";
import { runHistoricalBootstrap } from "../lib/returnsHistorical.ts";
import { runRegimeSwitching } from "../lib/returnsRegime.ts";
import { projectLifetime, type ProjectionAssumptions } from "../lib/projection.ts";
import { STRESS_SCENARIOS } from "../lib/stressTest.ts";
import { dpsGrowthFactor, growthAtYear, bucketGrowthFactor } from "../lib/dividends.ts";

const hh = DEMO_HOUSEHOLD;
const model = returnModel(hh.accounts);
const A: ProjectionAssumptions = {
  strategy: "smart", bracketTarget: 0.22, returnRate: 0.05, inflationRate: 0.025,
  endAge: 95, convert: { untilAge: 75, mode: "recommended" }, survivor: { firstDeathAge: 85, spendingFactor: 0.8 },
  heirTaxRate: 0.24, spendingStrategy: "constant",
} as any;
const B: ProjectionAssumptions = { ...A, strategy: "conventional", convert: null } as any;

console.log(`model: eq=${model.equityPct.toFixed(3)} bd=${model.bondPct.toFixed(3)} ca=${model.cashPct.toFixed(3)} expected=${model.expected} vol=${model.volatility} geo=${model.expectedGeometric}`);

// ---------- 1. runMonteCarlo determinism + success criterion + bands ----------
{
  const r1 = runMonteCarlo(hh, A, { model, runs: 400, seed: 12345 });
  const r2 = runMonteCarlo(hh, A, { model, runs: 400, seed: 12345 });
  const r3 = runMonteCarlo(hh, A, { model, runs: 400, seed: 54321 });
  console.log(`\ndeterminism: same seed successPct ${r1.successPct} == ${r2.successPct}: ${r1.successPct === r2.successPct && r1.endingWealth.p50 === r2.endingWealth.p50}`);
  console.log(`different seed differs: ${r1.endingWealth.p50 !== r3.endingWealth.p50} (p50 ${Math.round(r1.endingWealth.p50)} vs ${Math.round(r3.endingWealth.p50)})`);
  const bandsMono = r1.band.every((b) => b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90)
    && r1.bandReal.every((b) => b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90);
  console.log(`percentile bands monotone (p10<=p25<=p50<=p75<=p90) all years: ${bandsMono}`);
  const ew = r1.endingWealth;
  console.log(`ending wealth pctiles monotone: ${ew.p10 <= ew.p25 && ew.p25 <= ew.p50 && ew.p50 <= ew.p75 && ew.p75 <= ew.p90}; CVaR<=p10: ${r1.cvarEndingWealth <= ew.p10}`);
  console.log(`successPct=${r1.successPct} CI=[${r1.successCI.map((x) => x.toFixed(3))}]`);
}

// ---------- 2. realized portfolio return on engine paths vs model.expected ----------
{
  // capture the actual per-year returns the engine feeds the projection by
  // regenerating paths exactly as runMonteCarlo does
  function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = makeRng(12345);
  const df = 6, SHOCK_CLAMP = 4;
  const classes = [model.assets.equity, model.assets.bonds, model.assets.cash];
  const logp = classes.map((c) => {
    const sig2 = Math.log(1 + (c.vol * c.vol) / ((1 + c.mean) * (1 + c.mean)));
    return { weight: c.weight, muLog: Math.log(1 + c.mean) - sig2 / 2, sd: Math.sqrt(sig2) };
  });
  const INFL_CORR = { eq: -0.01, bonds: -0.24, cash: -0.03 };
  const c3 = model.corr;
  const L = cholesky([
    [c3[0][0], c3[0][1], c3[0][2], INFL_CORR.eq],
    [c3[1][0], c3[1][1], c3[1][2], INFL_CORR.bonds],
    [c3[2][0], c3[2][1], c3[2][2], INFL_CORR.cash],
    [INFL_CORR.eq, INFL_CORR.bonds, INFL_CORR.cash, 1],
  ]);
  const tScale = Math.sqrt((df - 2) / df);
  let s = 0, s2 = 0;
  const M = 500_000;
  for (let it = 0; it < M; it++) {
    const n = [randn(rng), randn(rng), randn(rng), randn(rng)];
    const z = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { let t = 0; for (let b = 0; b <= a; b++) t += L[a][b] * n[b]; z[a] = t; }
    let w = 0;
    for (let k = 0; k < df; k++) { const g = randn(rng); w += g * g; }
    const tFactor = Math.sqrt(df / Math.max(w, 1e-9)) * tScale;
    let port = 0;
    for (let i = 0; i < 3; i++) {
      const shock = Math.max(-SHOCK_CLAMP, Math.min(SHOCK_CLAMP, z[i] * tFactor));
      port += logp[i].weight * (Math.exp(logp[i].muLog + logp[i].sd * shock) - 1);
    }
    s += port; s2 += port * port;
  }
  const mean = s / M, sd = Math.sqrt(s2 / M - mean * mean);
  const wsum = classes.reduce((t, c) => t + c.weight * c.mean, 0);
  console.log(`\nportfolio path mean=${(mean * 100).toFixed(3)}%/yr vs blended arithmetic ${(wsum * 100).toFixed(3)}% (model.expected rounded ${(model.expected * 100).toFixed(1)}%)`);
  console.log(`portfolio path vol=${(sd * 100).toFixed(3)}% vs model.volatility ${(model.volatility * 100).toFixed(1)}%`);
}

// ---------- 3. CRN variance reduction ----------
{
  function makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const df = 6, SHOCK_CLAMP = 4;
  const classes = [model.assets.equity, model.assets.bonds, model.assets.cash];
  const logp = classes.map((c) => {
    const sig2 = Math.log(1 + (c.vol * c.vol) / ((1 + c.mean) * (1 + c.mean)));
    return { weight: c.weight, muLog: Math.log(1 + c.mean) - sig2 / 2, sd: Math.sqrt(sig2) };
  });
  const INFL_CORR = { eq: -0.01, bonds: -0.24, cash: -0.03 };
  const c3 = model.corr;
  const L = cholesky([
    [c3[0][0], c3[0][1], c3[0][2], INFL_CORR.eq],
    [c3[1][0], c3[1][1], c3[1][2], INFL_CORR.bonds],
    [c3[2][0], c3[2][1], c3[2][2], INFL_CORR.cash],
    [INFL_CORR.eq, INFL_CORR.bonds, INFL_CORR.cash, 1],
  ]);
  const tScale = Math.sqrt((df - 2) / df);
  const pibar = A.inflationRate, PHI = 0.6, SIGMA_INFL = 0.0177;
  const sigmaEps = SIGMA_INFL * Math.sqrt(1 - PHI * PHI);
  function genPath(rng: () => number, years: number) {
    const rets: number[] = [], infls: number[] = [];
    let prevInfl = pibar;
    for (let y = 0; y < years; y++) {
      const n = [randn(rng), randn(rng), randn(rng), randn(rng)];
      const z = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) { let t = 0; for (let b = 0; b <= a; b++) t += L[a][b] * n[b]; z[a] = t; }
      let w = 0;
      for (let k = 0; k < df; k++) { const g = randn(rng); w += g * g; }
      const tFactor = Math.sqrt(df / Math.max(w, 1e-9)) * tScale;
      let port = 0;
      for (let i = 0; i < 3; i++) {
        const shock = Math.max(-SHOCK_CLAMP, Math.min(SHOCK_CLAMP, z[i] * tFactor));
        port += logp[i].weight * (Math.exp(logp[i].muLog + logp[i].sd * shock) - 1);
      }
      const infl = Math.max(-0.02, Math.min(0.12, pibar + PHI * (prevInfl - pibar) + sigmaEps * z[3]));
      prevInfl = infl;
      rets.push(port); infls.push(infl);
    }
    return { rets, infls };
  }
  const detA = projectLifetime(hh, A);
  const detB = projectLifetime(hh, B);
  const YEARS = 45, RUNS = 300;
  const rngShared = makeRng(2026);
  const rngB = makeRng(777);
  const pairedDiff: number[] = [], indepDiff: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const p = genPath(rngShared, YEARS);
    const q = genPath(rngB, YEARS);
    const mk = (path: { rets: number[]; infls: number[] }) => ({
      returnFor: (i: number) => path.rets[Math.min(i, YEARS - 1)],
      inflationFor: (i: number) => path.infls[Math.min(i, YEARS - 1)],
    });
    const pa = projectLifetime(hh, { ...A, ...mk(p), futureRateOverride: detA.futureRate } as any);
    const pbSame = projectLifetime(hh, { ...B, ...mk(p), futureRateOverride: detB.futureRate } as any);
    const pbIndep = projectLifetime(hh, { ...B, ...mk(q), futureRateOverride: detB.futureRate } as any);
    pairedDiff.push(pa.endingEstateAfterTaxReal - pbSame.endingEstateAfterTaxReal);
    indepDiff.push(pa.endingEstateAfterTaxReal - pbIndep.endingEstateAfterTaxReal);
  }
  const varOf = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  };
  const vp = varOf(pairedDiff), vi = varOf(indepDiff);
  console.log(`\nCRN variance reduction (A=smart+conv vs B=conventional, ${RUNS} runs):`);
  console.log(`  sd(paired diff)=${Math.round(Math.sqrt(vp)).toLocaleString()}  sd(indep diff)=${Math.round(Math.sqrt(vi)).toLocaleString()}  variance ratio=${(vi / vp).toFixed(1)}x`);
}

// ---------- 4. runPairedMonteCarlo + rankMostMoney sanity ----------
{
  const pr = runPairedMonteCarlo(hh, A, B, { model, runs: 400, seed: 12345 });
  console.log(`\npaired: aWins=${pr.aWins.toFixed(3)} bWins=${pr.bWins.toFixed(3)} ties=${pr.ties.toFixed(3)} sum=${(pr.aWins + pr.bWins + pr.ties).toFixed(6)}`);
  console.log(`  successA=${pr.successA} successB=${pr.successB}; margin p50=${Math.round(pr.margin.p50).toLocaleString()} mean=${Math.round(pr.margin.mean).toLocaleString()}`);
  const pr2 = runPairedMonteCarlo(hh, A, B, { model, runs: 400, seed: 12345 });
  console.log(`  paired determinism: ${pr.margin.p50 === pr2.margin.p50}`);
  const stats = rankMostMoney(hh, [A, B, { ...A, bracketTarget: 0.24 } as any], { model, runs: 300, seed: 12345 });
  const wrSum = stats.reduce((s, x) => s + x.winRate, 0);
  console.log(`rankMostMoney winRate sum=${wrSum.toFixed(6)} (must be 1); stats=${stats.map((s) => `wr=${s.winRate.toFixed(3)} med=${Math.round(s.median / 1000)}k succ=${s.success}`).join(" | ")}`);
}

// ---------- 5. cross-engine agreement ----------
{
  const mc = runMonteCarlo(hh, A, { model, runs: 600, seed: 12345 });
  const hb = runHistoricalBootstrap(hh, A, { model, runs: 600, seed: 12345 });
  const rs = runRegimeSwitching(hh, A, { model, runs: 600, seed: 24680 });
  console.log(`\ncross-engine success: parametric=${mc.successPct.toFixed(3)} bootstrap=${hb.successPct.toFixed(3)} regime=${rs.successPct.toFixed(3)}`);
  console.log(`median real ending wealth: parametric=${Math.round(mc.endingWealthReal.p50 / 1000)}k bootstrap=${Math.round(hb.endingWealthReal.p50 / 1000)}k regime=${Math.round(rs.endingWealthReal.p50 / 1000)}k`);
  console.log(`regimeInfo: bull=${(rs.regimeInfo!.bullMean * 100).toFixed(2)}% bear=${(rs.regimeInfo!.bearMean * 100).toFixed(2)}% wBull=${rs.regimeInfo!.bullWeight}`);
}

// ---------- 6. stress scenarios vs official S&P history ----------
{
  console.log("\n== stress scenarios ==");
  const gfc = STRESS_SCENARIOS.find((s) => s.id === "gfc2008")!;
  const official0813 = [-0.37, 0.2646, 0.1506, 0.0211, 0.16, 0.3239];
  console.log(`gfc2008: ${gfc.returns.join(", ")}`);
  console.log(`official S&P TR 2008-13: ${official0813.join(", ")} -> max abs diff ${Math.max(...gfc.returns.map((r, i) => Math.abs(r - official0813[i]))).toFixed(4)}`);
  const lost = STRESS_SCENARIOS.find((s) => s.id === "lostdecade")!;
  const official0009 = [-0.091, -0.1189, -0.221, 0.2868, 0.1088, 0.0491, 0.1579, 0.0549, -0.37, 0.2646];
  console.log(`lostdecade max abs diff vs official 2000-09: ${Math.max(...lost.returns.map((r, i) => Math.abs(r - official0009[i]))).toFixed(4)}`);
  // order of application: year 0 must get returns[0]
  const probe: number[] = [];
  const returnFor = (i: number) => (i < gfc.returns.length ? gfc.returns[i] : 0.05);
  for (let i = 0; i < 8; i++) probe.push(returnFor(i));
  console.log(`applied sequence yrs0-7: ${probe.join(", ")} (reverts to baseline after year 5)`);
}

// ---------- 7. dividends ----------
{
  console.log("\n== dividends ==");
  const stockH: any = { ticker: "X", name: "X", type: "stock", shares: 100, price: 100, dividendPerShare: 2, dividendGrowthRate: 0.12 };
  // year-by-year growth applied
  const g1 = growthAtYear("stock", 0.12, 1), g10 = growthAtYear("stock", 0.12, 10), g5 = growthAtYear("stock", 0.12, 5);
  console.log(`stock fade: g(1)=${g1.toFixed(4)} (exp 0.12) g(5)=${g5.toFixed(4)} (exp linear ${(0.12 + (0.05 - 0.12) * (4 / 9)).toFixed(4)}) g(10)=${g10.toFixed(4)} (exp 0.05)`);
  let f = 1;
  for (let tau = 1; tau <= 3; tau++) f *= 1 + growthAtYear("stock", 0.12, tau);
  console.log(`dpsGrowthFactor(3)=${dpsGrowthFactor(stockH, 3).toFixed(6)} vs manual compound ${f.toFixed(6)} (equal => compounds once, no double growth)`);
  console.log(`dpsGrowthFactor(0)=${dpsGrowthFactor(stockH, 0)} (exp 1)`);
  const fund: any = { ticker: "F", name: "F", type: "etf", shares: 10, price: 50, dividendPerShare: 1, dividendGrowthRate: 0.06 };
  console.log(`fund factor(10)=${dpsGrowthFactor(fund, 10).toFixed(4)} vs 1.06^10=${Math.pow(1.06, 10).toFixed(4)}`);
  const bond: any = { ticker: "B", name: "B", type: "bond_fund", shares: 10, price: 50, dividendPerShare: 2, dividendGrowthRate: 0.05 };
  console.log(`bond factor(10)=${dpsGrowthFactor(bond, 10)} (exp 1 — 0% growth)`);
  console.log(`bucketGrowthFactor qualified t=3 (stock+fund): ${bucketGrowthFactor([stockH, fund], "qualified", 3).toFixed(4)} (income-weighted)`);
  const outlier: any = { ...stockH, dividendGrowthRate: 0.5 };
  console.log(`outlier 50% growth capped: g(1)=${growthAtYear("stock", 0.5, 1)} (exp 0.12 cap)`);
  const neg: any = { ...stockH, dividendGrowthRate: -0.1 };
  console.log(`negative growth stock: g(1)=${growthAtYear("stock", -0.1, 1)} (clamped to 0, then fades UP to 5% — note: a dividend-cutter is modeled as resuming growth)`);
}
