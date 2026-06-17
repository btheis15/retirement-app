"""
Regime-switching lognormal (Hardy's RSLN-2) — the actuarial-standard model for
long-horizon equity returns (used in CIA/AAA capital reserving). Two hidden
states — a calm bull regime (high mean, low vol) and a turbulent bear regime
(low/negative mean, high vol) — with Markov transition probabilities. It captures
volatility CLUSTERING and the fat left tail better than an i.i.d. draw, and is the
benchmark a reserving actuary would expect.

Fit by EM (statsmodels MarkovRegression, switching mean + variance) to annual
S&P 500 returns 1928-2024. Exports the regime means/vols + transition matrix to
lib/calibrated/regimes.json for the validation harness and (optionally) a TS
regime-switching engine.
"""

import json
import os
import warnings
import numpy as np
import statsmodels.api as sm
from research.data import STOCK

warnings.simplefilter("ignore")


def main():
    y = STOCK * 100.0  # percent, helps the optimizer scale
    mod = sm.tsa.MarkovRegression(y, k_regimes=2, trend="c", switching_variance=True)
    res = mod.fit(maxiter=200, em_iter=50)

    names = list(res.model.param_names)
    params = np.asarray(res.params)
    consts = np.array([params[i] for i, p in enumerate(names) if "const" in p])
    sig2 = np.array([params[i] for i, p in enumerate(names) if "sigma2" in p])
    means = consts / 100.0
    vols = np.sqrt(sig2) / 100.0
    # Order regimes: 0 = bull (higher mean), 1 = bear.
    order = np.argsort(-means)
    means, vols = means[order], vols[order]
    # statsmodels regime_transition is COLUMN-stochastic: P[i,j] = P(next=i | now=j).
    P = res.regime_transition[:, :, 0]
    P = P[np.ix_(order, order)]
    # Stationary distribution π satisfies P @ π = π (right-eigenvector, λ=1).
    evals, evecs = np.linalg.eig(P)
    stat = np.real(evecs[:, np.argmin(np.abs(evals - 1))])
    stat = stat / stat.sum()

    out = {
        "model": "Regime-Switching Lognormal (Hardy RSLN-2)",
        "source": "EM fit to annual S&P 500 total returns 1928-2024 (Damodaran)",
        "regimes": [
            {"name": "bull", "mean": round(float(means[0]), 4), "vol": round(float(vols[0]), 4),
             "stay": round(float(P[0, 0]), 3), "stationaryWeight": round(float(stat[0]), 3)},
            {"name": "bear", "mean": round(float(means[1]), 4), "vol": round(float(vols[1]), 4),
             "stay": round(float(P[1, 1]), 3), "stationaryWeight": round(float(stat[1]), 3)},
        ],
        "transition": [[round(float(P[i, j]), 3) for j in range(2)] for i in range(2)],
        # Blended long-run mean/vol implied by the regimes (mixture moments).
        "blendedMean": round(float(stat @ means), 4),
        "logLikelihood": round(float(res.llf), 1),
    }
    os.makedirs("research/out", exist_ok=True)
    os.makedirs("lib/calibrated", exist_ok=True)
    for path in ("research/out/regimes.json", "lib/calibrated/regimes.json"):
        with open(path, "w") as f:
            json.dump(out, f, indent=2)

    print("=== Regime-Switching Lognormal (RSLN-2) fit to S&P 1928-2024 ===")
    for r in out["regimes"]:
        print(f"  {r['name']:4s}: mean {r['mean']:+.1%}/yr vol {r['vol']:.1%} | stays {r['stay']:.0%} | "
              f"~{r['stationaryWeight']:.0%} of years")
    print(f"  blended long-run mean {out['blendedMean']:.1%}; logLik {out['logLikelihood']}")


if __name__ == "__main__":
    main()
