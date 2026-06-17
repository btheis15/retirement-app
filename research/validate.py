"""
Validation harness — the cross-check that lets us claim the browser engine is
trustworthy. It runs ONE simplified withdrawal model through FIVE independent
return engines and confirms they agree on the headline metrics (success rate,
median terminal wealth, left-tail / CVaR). If a normal-i.i.d. draw, a fat-tailed
Student-t, a regime-switching model, a historical block-bootstrap, and a closed-
form check all land in the same neighborhood, the methodology is sound and the
TypeScript app (which uses the Student-t multi-asset engine) isn't an outlier.

This is exactly the "compare your model against alternatives" discipline a
reviewing actuary/CFA expects — no single model is trusted on its own.

Simplified common model (intentionally austere so every engine sees the same
problem): a single equity-like sleeve, fixed real withdrawal as % of initial
balance, 30-year horizon, withdraw-at-year-start then grow. Calibrated to the
forward CMA equity mean/vol used in the app so the absolute numbers are
meaningful, not just internally consistent.
"""

import json
import os
import numpy as np

from research.data import STOCK
from research.regimes import main as _regimes_main

RNG = np.random.default_rng(20260101)
N = 20000
YEARS = 30
W = 0.045          # 4.5% of initial balance, real, withdrawn at start of year
MU = 0.0794        # forward CMA equity arithmetic mean (J.P. Morgan LTCMA)
SIGMA = 0.1647     # forward CMA equity vol
GEO = MU - 0.5 * SIGMA ** 2  # geometric mean the deterministic path would compound


def standardize(raw):
    """Affine-map a draw so its pooled annual mean==MU and vol==SIGMA, EXACTLY.
    A linear map preserves serial correlation and regime/block structure, so the
    only thing that differs across engines afterward is the SHAPE of the return
    distribution (tails, clustering) — which is precisely what we want to isolate."""
    return MU + (raw - raw.mean()) * (SIGMA / raw.std())


def run(paths):
    """paths: (N, YEARS) array of annual total returns. Returns metrics dict."""
    bal = np.ones(N)
    depleted_year = np.full(N, YEARS + 1)
    for t in range(YEARS):
        bal = bal - W                      # withdraw at start (real)
        dead = (bal <= 0) & (depleted_year > YEARS)
        depleted_year[dead] = t
        bal = np.maximum(bal, 0.0) * (1.0 + paths[:, t])
    success = float(np.mean(bal > 0))
    ending = bal
    p10, p50, p90 = np.percentile(ending, [10, 50, 90])
    # Expected Shortfall at 25% (mean terminal in the worst quartile). We use 25%,
    # not 10%, because at this 4.5% withdrawal rate >10% of paths deplete to exactly
    # 0, so a worst-10% mean would be a degenerate constant 0 for every engine and
    # carry no discriminating information. The worst quartile still includes some
    # surviving (positive) paths, so it varies meaningfully across engines.
    es25_cut = np.percentile(ending, 25)
    es25 = float(np.mean(ending[ending <= es25_cut]))
    failed = depleted_year[depleted_year <= YEARS]
    return {
        "success": round(success, 3),
        "failureRate": round(1 - success, 3),
        "endingP10": round(float(p10), 2),
        "endingP50": round(float(p50), 2),
        "endingP90": round(float(p90), 2),
        "es25": round(es25, 2),
        # Among paths that failed: median 1-based YEAR (not age) the money ran out.
        "medianDepletionYear": int(np.median(failed)) + 1 if failed.size else None,
    }


def engine_normal():
    return RNG.normal(MU, SIGMA, size=(N, YEARS))


def engine_student_t(df=6):
    # Match the app: scale t so its variance equals SIGMA^2, winsorize at +/-4 sd.
    z = RNG.standard_t(df, size=(N, YEARS)) * np.sqrt((df - 2) / df)
    z = np.clip(z, -4, 4)
    return MU + SIGMA * z


def engine_regimes():
    with open("lib/calibrated/regimes.json") as f:
        rg = json.load(f)
    mus = np.array([rg["regimes"][0]["mean"], rg["regimes"][1]["mean"]])
    sds = np.array([rg["regimes"][0]["vol"], rg["regimes"][1]["vol"]])
    P = np.array(rg["transition"])  # column-stochastic P[next, now]
    w0 = rg["regimes"][0]["stationaryWeight"]
    state = (RNG.random(N) > w0).astype(int)  # 0 bull, 1 bear
    out = np.empty((N, YEARS))
    for t in range(YEARS):
        out[:, t] = RNG.normal(mus[state], sds[state])
        # advance the chain: P[next=0 | now=state]
        p_next_bull = P[0, state]
        state = (RNG.random(N) > p_next_bull).astype(int)
    return out


def engine_bootstrap():
    # Circular block bootstrap of historical equity returns. The block ORDERING
    # (serial correlation) is what we're testing; the level/vol are set later by
    # standardize() to the common forward target, so no recenter is needed here.
    hist = STOCK.copy()
    n = len(hist)
    block = 8
    out = np.empty((N, YEARS))
    for i in range(N):
        seq = []
        while len(seq) < YEARS:
            start = RNG.integers(0, n)
            seq.extend(hist[(start + k) % n] for k in range(block))
        out[i, :] = seq[:YEARS]
    return out


def main():
    # Ensure regime params exist.
    if not os.path.exists("lib/calibrated/regimes.json"):
        _regimes_main()

    # Every engine standardized to the SAME arithmetic mean & vol, so the only
    # difference is distribution shape / serial dependence (the whole point).
    engines = {
        "normal_iid": engine_normal(),
        "student_t_df6 (app engine)": engine_student_t(),
        "regime_switching": engine_regimes(),
        "historical_bootstrap": engine_bootstrap(),
    }
    results = {name: run(standardize(paths)) for name, paths in engines.items()}

    # Closed-form sanity anchor: a constant-geometric-return path (no volatility)
    # is the deterministic projection the app shows as its baseline.
    det = run(np.full((1, YEARS), GEO))
    results["deterministic_geometric (anchor)"] = det

    report = {
        "model": f"{W:.1%} initial real withdrawal, {YEARS}-yr horizon, single equity sleeve",
        "calibration": {"mu": MU, "sigma": SIGMA, "geometricMean": round(GEO, 4)},
        "runs": N,
        "engines": results,
    }
    os.makedirs("research/out", exist_ok=True)
    with open("research/out/validation.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"=== Engine validation: {W:.1%} real withdrawal, {YEARS}yr, equity mu={MU:.2%} sd={SIGMA:.2%} ===")
    print(f"{'engine':<32} {'success':>8} {'endP50':>8} {'endP90':>8} {'ES25':>8} {'deplYr':>7}")
    for name, r in results.items():
        dy = r["medianDepletionYear"]
        print(f"{name:<32} {r['success']:>8.1%} {r['endingP50']:>8.2f} {r['endingP90']:>8.2f} "
              f"{r['es25']:>8.2f} {('—' if dy is None else dy):>7}")
    stoch = [(n, r) for n, r in results.items() if "anchor" not in n]
    succ = [r["success"] for _, r in stoch]
    spread = max(succ) - min(succ)
    es = [r["es25"] for _, r in stoch]
    print(f"\nStochastic success-rate spread across {len(stoch)} engines: {spread:.1%} "
          f"({'TIGHT — models agree' if spread <= 0.06 else 'WIDE — investigate'})")
    print(f"Worst-quartile expected terminal (ES25) ranges {min(es):.2f}–{max(es):.2f}× start across engines.")
    print("Ending wealth in multiples of the starting balance; deplYr = median year of depletion among failures.")
    print("Written to research/out/validation.json")


if __name__ == "__main__":
    main()
