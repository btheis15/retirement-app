/**
 * Historical block-bootstrap engine — the cFIREsim/FICalc "second opinion."
 *
 * Instead of drawing returns from a parametric distribution, it samples random
 * CONTIGUOUS BLOCKS of actual U.S. market history (stocks/bonds/bills/inflation,
 * 1928–2024), so it captures — for free, with no assumptions — fat tails, serial
 * correlation/mean reversion, and the real joint behavior of stocks, bonds, and
 * inflation (e.g. the 1966 stagflation cohort). Each block preserves the year-to-
 * year ordering that drives sequence-of-returns risk.
 *
 * To keep it comparable to the forward-looking parametric engine, returns are
 * DETRENDED to the same 2026 capital-market means (a constant per-class shift that
 * preserves history's variance, fat tails, and correlations) — so the two engines
 * differ in DISTRIBUTION SHAPE, not in their long-run average, and any divergence
 * is meaningful rather than a 3–5%/yr level artifact.
 *
 * ⚠️ Educational estimates only. Past sequences are not a forecast.
 */

import { Household } from "./accounts";
import { projectLifetime, ProjectionAssumptions } from "./projection";
import { ReturnModel } from "./returns";
import { MonteCarloResult, wilsonInterval } from "./monteCarlo";

export interface HistRow {
  year: number;
  stock: number; // S&P 500 total return (decimal)
  bond: number; // US 10-yr Treasury total return
  bill: number; // 3-mo T-bill return
  infl: number; // CPI inflation
}

/**
 * Annual US returns (decimals), 1928–2024 — Aswath Damodaran (NYU Stern),
 * "Historical Returns on Stocks, Bonds and Bills." Independently cross-verified
 * across two pulls (agreement within rounding) and spot-checked against known
 * anchors (1931 −43.8%, 2008 −36.6%, 2022 stocks −18.0% & bonds −17.8%, 1980 CPI
 * +12.5%). stock = S&P 500 total return; bond = 10-yr Treasury total return;
 * bill = 3-mo T-bill; infl = CPI.
 */
export const HISTORICAL_ANNUAL: HistRow[] = [
  { year: 1928, stock: 0.43811, bond: 0.00835, bill: 0.0308, infl: -0.01156 },
  { year: 1929, stock: -0.08298, bond: 0.04204, bill: 0.0316, infl: 0.00585 },
  { year: 1930, stock: -0.25124, bond: 0.04541, bill: 0.0455, infl: -0.06395 },
  { year: 1931, stock: -0.43838, bond: -0.02559, bill: 0.0231, infl: -0.09317 },
  { year: 1932, stock: -0.08642, bond: 0.0879, bill: 0.0107, infl: -0.10274 },
  { year: 1933, stock: 0.49982, bond: 0.01855, bill: 0.0096, infl: 0.00763 },
  { year: 1934, stock: -0.01189, bond: 0.07963, bill: 0.00278, infl: 0.01515 },
  { year: 1935, stock: 0.4674, bond: 0.04472, bill: 0.00168, infl: 0.02985 },
  { year: 1936, stock: 0.31943, bond: 0.05018, bill: 0.00172, infl: 0.01449 },
  { year: 1937, stock: -0.35337, bond: 0.01379, bill: 0.00276, infl: 0.02857 },
  { year: 1938, stock: 0.29283, bond: 0.04213, bill: 0.00065, infl: -0.02778 },
  { year: 1939, stock: -0.01098, bond: 0.04412, bill: 0.00046, infl: 0 },
  { year: 1940, stock: -0.10673, bond: 0.05402, bill: 0.00036, infl: 0.00714 },
  { year: 1941, stock: -0.12771, bond: -0.02022, bill: 0.00129, infl: 0.09929 },
  { year: 1942, stock: 0.19174, bond: 0.02295, bill: 0.00343, infl: 0.09032 },
  { year: 1943, stock: 0.25061, bond: 0.0249, bill: 0.0038, infl: 0.02959 },
  { year: 1944, stock: 0.19031, bond: 0.02578, bill: 0.0038, infl: 0.02299 },
  { year: 1945, stock: 0.35821, bond: 0.03804, bill: 0.0038, infl: 0.02247 },
  { year: 1946, stock: -0.08429, bond: 0.03128, bill: 0.0038, infl: 0.18132 },
  { year: 1947, stock: 0.052, bond: 0.0092, bill: 0.00601, infl: 0.08837 },
  { year: 1948, stock: 0.05705, bond: 0.01951, bill: 0.01045, infl: 0.02991 },
  { year: 1949, stock: 0.18303, bond: 0.04663, bill: 0.01115, infl: -0.02075 },
  { year: 1950, stock: 0.30806, bond: 0.0043, bill: 0.01203, infl: 0.05932 },
  { year: 1951, stock: 0.23678, bond: -0.00295, bill: 0.01518, infl: 0.06 },
  { year: 1952, stock: 0.18151, bond: 0.02268, bill: 0.01723, infl: 0.00755 },
  { year: 1953, stock: -0.01208, bond: 0.04144, bill: 0.01891, infl: 0.00749 },
  { year: 1954, stock: 0.52563, bond: 0.0329, bill: 0.00938, infl: -0.00743 },
  { year: 1955, stock: 0.32597, bond: -0.01336, bill: 0.01724, infl: 0.00375 },
  { year: 1956, stock: 0.0744, bond: -0.02256, bill: 0.02621, infl: 0.02985 },
  { year: 1957, stock: -0.10457, bond: 0.06797, bill: 0.03225, infl: 0.02899 },
  { year: 1958, stock: 0.4372, bond: -0.02099, bill: 0.01767, infl: 0.01761 },
  { year: 1959, stock: 0.12056, bond: -0.02647, bill: 0.03386, infl: 0.0173 },
  { year: 1960, stock: 0.00337, bond: 0.1164, bill: 0.02873, infl: 0.01361 },
  { year: 1961, stock: 0.26638, bond: 0.02061, bill: 0.02352, infl: 0.00671 },
  { year: 1962, stock: -0.08811, bond: 0.05694, bill: 0.02772, infl: 0.01333 },
  { year: 1963, stock: 0.22612, bond: 0.01684, bill: 0.03156, infl: 0.01645 },
  { year: 1964, stock: 0.16415, bond: 0.03728, bill: 0.03546, infl: 0.00971 },
  { year: 1965, stock: 0.12399, bond: 0.00719, bill: 0.03949, infl: 0.01923 },
  { year: 1966, stock: -0.09971, bond: 0.02908, bill: 0.04856, infl: 0.03459 },
  { year: 1967, stock: 0.23803, bond: -0.01581, bill: 0.04293, infl: 0.0304 },
  { year: 1968, stock: 0.10815, bond: 0.03275, bill: 0.05338, infl: 0.0472 },
  { year: 1969, stock: -0.08241, bond: -0.05014, bill: 0.06668, infl: 0.06197 },
  { year: 1970, stock: 0.03561, bond: 0.16755, bill: 0.06391, infl: 0.0557 },
  { year: 1971, stock: 0.14221, bond: 0.09787, bill: 0.04334, infl: 0.03266 },
  { year: 1972, stock: 0.18755, bond: 0.02818, bill: 0.04062, infl: 0.03406 },
  { year: 1973, stock: -0.14308, bond: 0.03659, bill: 0.07035, infl: 0.08706 },
  { year: 1974, stock: -0.25902, bond: 0.01989, bill: 0.07846, infl: 0.12338 },
  { year: 1975, stock: 0.36995, bond: 0.03605, bill: 0.05786, infl: 0.06936 },
  { year: 1976, stock: 0.23831, bond: 0.15985, bill: 0.04977, infl: 0.04865 },
  { year: 1977, stock: -0.0698, bond: 0.0129, bill: 0.05261, infl: 0.06701 },
  { year: 1978, stock: 0.06509, bond: -0.00778, bill: 0.07178, infl: 0.09018 },
  { year: 1979, stock: 0.18519, bond: 0.00671, bill: 0.10054, infl: 0.13294 },
  { year: 1980, stock: 0.31735, bond: -0.0299, bill: 0.11392, infl: 0.12516 },
  { year: 1981, stock: -0.04702, bond: 0.08199, bill: 0.14036, infl: 0.08922 },
  { year: 1982, stock: 0.20419, bond: 0.32815, bill: 0.1109, infl: 0.0383 },
  { year: 1983, stock: 0.22337, bond: 0.032, bill: 0.0895, infl: 0.03791 },
  { year: 1984, stock: 0.06146, bond: 0.13733, bill: 0.0992, infl: 0.03949 },
  { year: 1985, stock: 0.31235, bond: 0.25712, bill: 0.0772, infl: 0.03799 },
  { year: 1986, stock: 0.18495, bond: 0.24284, bill: 0.0615, infl: 0.01098 },
  { year: 1987, stock: 0.05813, bond: -0.04961, bill: 0.0596, infl: 0.04434 },
  { year: 1988, stock: 0.16537, bond: 0.08224, bill: 0.0689, infl: 0.04419 },
  { year: 1989, stock: 0.31475, bond: 0.17694, bill: 0.0839, infl: 0.04647 },
  { year: 1990, stock: -0.03064, bond: 0.06235, bill: 0.0775, infl: 0.06106 },
  { year: 1991, stock: 0.30235, bond: 0.15005, bill: 0.0554, infl: 0.03064 },
  { year: 1992, stock: 0.07494, bond: 0.09362, bill: 0.0351, infl: 0.02901 },
  { year: 1993, stock: 0.09967, bond: 0.14211, bill: 0.0307, infl: 0.02748 },
  { year: 1994, stock: 0.01326, bond: -0.08037, bill: 0.0437, infl: 0.02675 },
  { year: 1995, stock: 0.37195, bond: 0.23481, bill: 0.0566, infl: 0.02538 },
  { year: 1996, stock: 0.22681, bond: 0.01429, bill: 0.0515, infl: 0.03322 },
  { year: 1997, stock: 0.33104, bond: 0.09939, bill: 0.052, infl: 0.01702 },
  { year: 1998, stock: 0.28338, bond: 0.14921, bill: 0.0491, infl: 0.01612 },
  { year: 1999, stock: 0.20885, bond: -0.08254, bill: 0.0478, infl: 0.02685 },
  { year: 2000, stock: -0.09032, bond: 0.16655, bill: 0.06, infl: 0.03387 },
  { year: 2001, stock: -0.1185, bond: 0.05572, bill: 0.0348, infl: 0.01552 },
  { year: 2002, stock: -0.21966, bond: 0.15116, bill: 0.0164, infl: 0.02377 },
  { year: 2003, stock: 0.28356, bond: 0.00375, bill: 0.0103, infl: 0.01879 },
  { year: 2004, stock: 0.10743, bond: 0.04491, bill: 0.014, infl: 0.03256 },
  { year: 2005, stock: 0.04834, bond: 0.02868, bill: 0.0322, infl: 0.03416 },
  { year: 2006, stock: 0.15613, bond: 0.01961, bill: 0.0485, infl: 0.02541 },
  { year: 2007, stock: 0.05485, bond: 0.1021, bill: 0.0448, infl: 0.04081 },
  { year: 2008, stock: -0.36552, bond: 0.20101, bill: 0.014, infl: 0.00091 },
  { year: 2009, stock: 0.25935, bond: -0.11117, bill: 0.0015, infl: 0.02721 },
  { year: 2010, stock: 0.14821, bond: 0.08463, bill: 0.0014, infl: 0.01496 },
  { year: 2011, stock: 0.02098, bond: 0.16035, bill: 0.0005, infl: 0.02962 },
  { year: 2012, stock: 0.15891, bond: 0.02972, bill: 0.0009, infl: 0.01741 },
  { year: 2013, stock: 0.32145, bond: -0.09105, bill: 0.0006, infl: 0.01502 },
  { year: 2014, stock: 0.13524, bond: 0.10746, bill: 0.0003, infl: 0.00756 },
  { year: 2015, stock: 0.01379, bond: 0.01284, bill: 0.0005, infl: 0.0073 },
  { year: 2016, stock: 0.11773, bond: 0.00691, bill: 0.0032, infl: 0.02075 },
  { year: 2017, stock: 0.21605, bond: 0.02802, bill: 0.0095, infl: 0.02109 },
  { year: 2018, stock: -0.04227, bond: -0.00017, bill: 0.0197, infl: 0.0191 },
  { year: 2019, stock: 0.31212, bond: 0.09636, bill: 0.0211, infl: 0.02285 },
  { year: 2020, stock: 0.18023, bond: 0.11332, bill: 0.0036, infl: 0.01362 },
  { year: 2021, stock: 0.28469, bond: -0.04416, bill: 0.0004, infl: 0.07036 },
  { year: 2022, stock: -0.18038, bond: -0.17828, bill: 0.0209, infl: 0.06454 },
  { year: 2023, stock: 0.26061, bond: 0.0388, bill: 0.0528, infl: 0.03352 },
  { year: 2024, stock: 0.24879, bond: -0.01637, bill: 0.0518, infl: 0.02888 },
];

function pctl(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export interface BootstrapOptions {
  model: ReturnModel;
  runs?: number;
  seed?: number;
  /** Contiguous block length in years (preserves serial correlation). Default 8. */
  blockYears?: number;
}

/** mulberry32 — same seeded RNG family as the parametric engine. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runHistoricalBootstrap(
  household: Household,
  assumptions: ProjectionAssumptions,
  opts: BootstrapOptions,
): MonteCarloResult {
  const runs = opts.runs ?? 1000;
  const blockYears = opts.blockYears ?? 8;
  const rng = makeRng(opts.seed ?? 12345);
  const data = HISTORICAL_ANNUAL;
  const N = data.length;
  const m = opts.model;
  const we = m.assets.equity.weight;
  const wb = m.assets.bonds.weight;
  const wc = m.assets.cash.weight;

  // Detrend each series to the forward means (constant shift preserves variance,
  // fat tails, and cross-correlations) so the engine matches the CMA level.
  const adjStock = m.assets.equity.mean - mean(data.map((d) => d.stock));
  const adjBond = m.assets.bonds.mean - mean(data.map((d) => d.bond));
  const adjBill = m.assets.cash.mean - mean(data.map((d) => d.bill));
  // Inflation is detrended to the assumed rate AND then clamped per-year to
  // [−2%, +12%] when sampled. The clamp is asymmetric against history (it lifts
  // the 1930s deflation years more than it trims the 1946/1979 spikes), which
  // would leave the post-clamp mean ~15–20bp ABOVE the target — a systematic
  // pessimism bias compounding to ~5% price-level drift over 30 years. A few
  // fixed-point passes solve for the shift whose POST-clamp mean hits the target,
  // keeping this engine's long-run average aligned with the parametric engines
  // (they differ in distribution shape, not level).
  const clampInfl = (x: number) => Math.max(-0.02, Math.min(0.12, x));
  let adjInfl = assumptions.inflationRate - mean(data.map((d) => d.infl));
  for (let pass = 0; pass < 4; pass++) {
    const clampedMean = mean(data.map((d) => clampInfl(d.infl + adjInfl)));
    adjInfl += assumptions.inflationRate - clampedMean;
  }

  const portReturn = (d: HistRow) =>
    Math.max(-0.99, we * (d.stock + adjStock) + wb * (d.bond + adjBond) + wc * (d.bill + adjBill));

  const det = projectLifetime(household, assumptions);
  const futureRateOverride = det.futureRate;

  const endings: number[] = [];
  const endingsReal: number[] = [];
  const shortfallAges: number[] = [];
  const cuts: number[] = [];
  let successes = 0;
  const cols: number[][] = [];
  const colsReal: number[][] = [];

  for (let r = 0; r < runs; r++) {
    const rets: number[] = [];
    const infls: number[] = [];
    const ensure = (i: number) => {
      while (rets.length <= i) {
        const start = Math.floor(rng() * N); // random block start (circular)
        for (let k = 0; k < blockYears && rets.length <= i + blockYears; k++) {
          const d = data[(start + k) % N];
          rets.push(portReturn(d));
          infls.push(clampInfl(d.infl + adjInfl));
        }
      }
    };
    const returnFor = (i: number) => {
      ensure(i);
      return rets[i];
    };
    const inflationFor = (i: number) => {
      ensure(i);
      return infls[i];
    };
    const proj = projectLifetime(household, { ...assumptions, returnFor, inflationFor, futureRateOverride });
    endings.push(proj.endingEstate);
    endingsReal.push(proj.endingEstateReal);
    cuts.push(Math.max(0, 1 - proj.minRealSpendRatio));
    if (proj.depleted) {
      const short = proj.rows.find((row) => row.shortfall);
      shortfallAges.push(short ? short.selfAge : det.rows[det.rows.length - 1]?.selfAge ?? 0);
    } else {
      successes++;
    }
    proj.rows.forEach((row, i) => {
      (cols[i] ??= []).push(row.endTotal);
      (colsReal[i] ??= []).push(row.inflationFactor > 0 ? row.endTotal / row.inflationFactor : row.endTotal);
    });
  }

  endings.sort((a, b) => a - b);
  endingsReal.sort((a, b) => a - b);
  shortfallAges.sort((a, b) => a - b);
  cuts.sort((a, b) => a - b);
  const worstCount = Math.max(1, Math.floor(runs * 0.1));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const ci = wilsonInterval(successes, runs);
  const pctlBand = (matrix: number[][]) =>
    matrix.map((col, i) => {
      col.sort((a, b) => a - b);
      return {
        year: det.rows[i]?.year ?? 0,
        selfAge: det.rows[i]?.selfAge ?? 0,
        p10: pctl(col, 0.1),
        p25: pctl(col, 0.25),
        p50: pctl(col, 0.5),
        p75: pctl(col, 0.75),
        p90: pctl(col, 0.9),
      };
    });
  const wealthPctiles = (xs: number[]) => ({
    p10: pctl(xs, 0.1),
    p25: pctl(xs, 0.25),
    p50: pctl(xs, 0.5),
    p75: pctl(xs, 0.75),
    p90: pctl(xs, 0.9),
  });

  return {
    runs,
    successPct: ci.p,
    successCI: [ci.lo, ci.hi],
    successSE: ci.se,
    endingWealth: wealthPctiles(endings),
    endingWealthReal: wealthPctiles(endingsReal),
    cvarEndingWealth: avg(endings.slice(0, worstCount)),
    cvarEndingWealthReal: avg(endingsReal.slice(0, worstCount)),
    medianShortfallAge: shortfallAges.length ? pctl(shortfallAges, 0.5) : 0,
    spendCut: { p50: pctl(cuts, 0.5), p90: pctl(cuts, 0.9) },
    band: pctlBand(cols),
    bandReal: pctlBand(colsReal),
    expectedReturn: m.expected,
    volatility: m.volatility,
  };
}
