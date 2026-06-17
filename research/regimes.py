"""
Regime-switching lognormal (Hardy's RSLN-2) — the actuarial-standard model for
long-horizon equity returns (used in CIA/AAA capital reserving). Two hidden
states — a calm bull regime (high positive mean) most of the time, punctuated by
a sharply NEGATIVE-mean bear regime — with Markov transition probabilities. The
bear's danger is its deeply negative mean and its PERSISTENCE (a down year is
much more likely to be followed by another), not a higher within-regime variance:
the EM fit actually gives the two regimes SIMILAR vols (bull ~16%, bear ~13%). The
model's fat left tail and clustering come from regime switching on the MEAN plus
the between-regime mean gap (mixture variance), which an i.i.d. draw can't produce.

Fit by EM (statsmodels MarkovRegression, switching mean + variance) to annual
S&P 500 returns 1928-2024. Exports the regime means/vols + transition matrix +
standard errors to lib/calibrated/regimes.json. NOTE: the bear regime is
identified from only ~11 of 97 historical years, so its mean/vol carry wide
standard errors (reported in the JSON) — treat the bear params as indicative.
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
    try:
        bse = np.asarray(res.bse)
    except Exception:
        bse = np.full_like(params, np.nan)
    const_idx = [i for i, p in enumerate(names) if "const" in p]
    sig2_idx = [i for i, p in enumerate(names) if "sigma2" in p]
    consts = params[const_idx]
    sig2 = params[sig2_idx]
    means = consts / 100.0
    vols = np.sqrt(sig2) / 100.0
    # Standard error of each regime MEAN (params are in percent → /100 to decimals).
    mean_se = np.array([bse[i] for i in const_idx]) / 100.0
    # Order regimes: 0 = bull (higher mean), 1 = bear.
    order = np.argsort(-means)
    means, vols, mean_se = means[order], vols[order], mean_se[order]
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
             "meanSE": round(float(mean_se[0]), 4) if np.isfinite(mean_se[0]) else None,
             "stay": round(float(P[0, 0]), 3), "stationaryWeight": round(float(stat[0]), 3),
             "expectedSpellYears": round(1.0 / max(1e-6, 1.0 - float(P[0, 0])), 1)},
            {"name": "bear", "mean": round(float(means[1]), 4), "vol": round(float(vols[1]), 4),
             "meanSE": round(float(mean_se[1]), 4) if np.isfinite(mean_se[1]) else None,
             "stay": round(float(P[1, 1]), 3), "stationaryWeight": round(float(stat[1]), 3),
             "expectedSpellYears": round(1.0 / max(1e-6, 1.0 - float(P[1, 1])), 1)},
        ],
        "transition": [[round(float(P[i, j]), 3) for j in range(2)] for i in range(2)],
        # Blended long-run mean/vol implied by the regimes (mixture moments).
        "blendedMean": round(float(stat @ means), 4),
        "mixtureVol": round(float(np.sqrt(stat @ (vols ** 2 + (means - (stat @ means)) ** 2))), 4),
        # ~years of data identifying the bear regime (n * stationary bear weight).
        "bearYearsIdentified": round(float(len(STOCK) * stat[1]), 1),
        "logLikelihood": round(float(res.llf), 1),
    }
    os.makedirs("research/out", exist_ok=True)
    os.makedirs("lib/calibrated", exist_ok=True)
    for path in ("research/out/regimes.json", "lib/calibrated/regimes.json"):
        with open(path, "w") as f:
            json.dump(out, f, indent=2)

    print("=== Regime-Switching Lognormal (RSLN-2) fit to S&P 1928-2024 ===")
    for r in out["regimes"]:
        se = f"±{r['meanSE']:.1%}" if r["meanSE"] is not None else "±n/a"
        print(f"  {r['name']:4s}: mean {r['mean']:+.1%}/yr ({se}) vol {r['vol']:.1%} | stays {r['stay']:.0%} "
              f"(~{r['expectedSpellYears']}yr spells) | ~{r['stationaryWeight']:.0%} of years")
    print(f"  blended long-run mean {out['blendedMean']:.1%}, mixture vol {out['mixtureVol']:.1%}; "
          f"bear identified from ~{out['bearYearsIdentified']} of {len(STOCK)} yrs; logLik {out['logLikelihood']}")


if __name__ == "__main__":
    main()
