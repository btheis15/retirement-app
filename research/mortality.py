"""
Mortality / longevity model — Gompertz law, calibrated to SSA 2021 period life
table survivorship, in the style of Milevsky's retirement-longevity work.

WHY: a fixed "plan to age 95" is crude. Real longevity is uncertain, and for a
COUPLE the relevant horizon is the LAST survivor (the money must last until both
have died). Modeling survival probabilities lets the app weight outcomes by the
chance you're alive to experience them and suggest a horizon with a defensible
tail probability (e.g., the age the last survivor has only a 10% chance to reach).

Gompertz force of mortality:  mu(x) = (1/b) * exp((x - m) / b)
t-year survival from age x:    S(x, t) = exp( exp((x-m)/b) * (1 - exp(t/b)) )
  m = modal age at death, b = dispersion. Fit (m, b) by least squares to SSA
  conditional survival from 65. Joint last-survivor (independent lives):
    S_couple = 1 - (1 - S_self) * (1 - S_spouse).

Outputs research/out/mortality.json -> lib/calibrated/mortality.json (m, b per
sex + blended), with validation against SSA life expectancy at 65.
"""

import json
import os
import numpy as np
from scipy.optimize import curve_fit

# SSA 2021 period life table — conditional probability of a 65-year-old SURVIVING
# to age x (lx[x]/lx[65]). Anchor points from the Social Security Administration
# 2021 period life table (published survivors column), male & female.
AGES = np.array([65, 70, 75, 80, 85, 90, 95, 100, 105])
SSA_2021 = {
    # P(65-year-old survives to age x)
    "male":   np.array([1.000, 0.901, 0.781, 0.629, 0.443, 0.249, 0.099, 0.025, 0.003]),
    "female": np.array([1.000, 0.929, 0.836, 0.709, 0.541, 0.342, 0.162, 0.050, 0.008]),
}


def gompertz_survival(age, t, m, b):
    """t-year survival probability from `age` under Gompertz(m, b)."""
    return np.exp(np.exp((age - m) / b) * (1.0 - np.exp(t / b)))


def fit_gompertz(survival_from_65):
    """Fit (m, b) to SSA conditional survival from age 65."""
    t = AGES - 65.0

    def model(tt, m, b):
        return gompertz_survival(65.0, tt, m, b)

    (m, b), _ = curve_fit(model, t, survival_from_65, p0=[88.0, 10.0], maxfev=20000)
    return float(m), float(b)


def life_expectancy(age, m, b, cap=120):
    """COMPLETE life expectancy (remaining years) from `age`. The curtate sum of
    annual survival probabilities understates the complete value by ~0.5yr (deaths
    occur mid-year), so we add the standard half-year correction — matching how SSA
    reports period life expectancy."""
    ts = np.arange(1, cap - age + 1)
    return float(np.sum(gompertz_survival(age, ts, m, b))) + 0.5


def main():
    out = {"model": "Gompertz", "source": "Fit to SSA 2021 period life table (survival from age 65)", "sex": {}}
    for sex, surv in SSA_2021.items():
        m, b = fit_gompertz(surv)
        # Validation: model vs SSA at each anchor + life expectancy at 65.
        model_surv = gompertz_survival(65.0, AGES - 65.0, m, b)
        rmse = float(np.sqrt(np.mean((model_surv - surv) ** 2)))
        out["sex"][sex] = {
            "m": round(m, 2),
            "b": round(b, 2),
            "lifeExpectancyAt65": round(65 + life_expectancy(65, m, b), 1),
            "pReach90from65": round(float(gompertz_survival(65, 25, m, b)), 3),
            "pReach95from65": round(float(gompertz_survival(65, 30, m, b)), 3),
            "fitRMSE": round(rmse, 4),
        }
    # Blended (unisex) params — used when sex isn't entered. Fit Gompertz to the
    # actual 50/50 survival MIXTURE of the male & female curves (not an average of
    # the two (m,b) pairs, which has no distributional meaning).
    surv_blend = 0.5 * SSA_2021["male"] + 0.5 * SSA_2021["female"]
    mb, bb = fit_gompertz(surv_blend)
    out["blended"] = {"m": round(mb, 2), "b": round(bb, 2),
                      "lifeExpectancyAt65": round(65 + life_expectancy(65, mb, bb), 1)}
    os.makedirs("research/out", exist_ok=True)
    os.makedirs("lib/calibrated", exist_ok=True)
    for path in ("research/out/mortality.json", "lib/calibrated/mortality.json"):
        with open(path, "w") as f:
            json.dump(out, f, indent=2)

    print("=== Gompertz mortality fit (SSA 2021) ===")
    for sex, v in out["sex"].items():
        print(f"  {sex:6s}: m={v['m']:.2f} b={v['b']:.2f} | LE@65={v['lifeExpectancyAt65']:.1f} "
              f"P(reach90)={v['pReach90from65']:.0%} P(reach95)={v['pReach95from65']:.0%} RMSE={v['fitRMSE']:.4f}")
    print(f"  blended (fit to 50/50 survival mixture): m={out['blended']['m']:.2f} b={out['blended']['b']:.2f} "
          f"LE@65={out['blended']['lifeExpectancyAt65']:.1f}")
    print("  LE@65 is COMPLETE (curtate + 0.5), matching SSA reporting. Written to lib/calibrated/mortality.json")


if __name__ == "__main__":
    main()
