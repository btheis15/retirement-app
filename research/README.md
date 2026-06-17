# Modeling Lab (`research/`)

Offline Python "modeling lab" that **calibrates** the parameters the browser app
uses and **validates** that the app's Monte-Carlo methodology is sound. None of
this runs in the app or in the user's browser — the production engine is pure
TypeScript (so it works offline, on a phone, with no server). This lab is where
the heavy scientific computing happens once, on the developer's machine, and the
results are exported as small JSON files into [`lib/calibrated/`](../lib/calibrated)
that the TypeScript engine reads as constants.

> **Why this split?** The app has to run in a non-technical user's browser and is
> headed for iOS — it can't ship a Python runtime. But the *parameters* behind it
> (mortality curves, regime dynamics) deserve real statistical fitting, and the
> *methodology* deserves independent cross-checking. That's this lab's job:
> do the PhD-grade work offline, ship the distilled numbers.

## Scientific stack

`numpy`, `pandas`, `scipy`, `statsmodels` (Python 3.14). Install:

```bash
pip install numpy pandas scipy statsmodels
```

## Modules

Run from the repo root as modules (so the `research.` package imports resolve):

| Module | What it does | Output |
|---|---|---|
| `python3 -m research.mortality` | Fits a **Gompertz** mortality law to the SSA 2021 period life table (Milevsky-style longevity modeling). Validated against published life-expectancy-at-65 and P(reach 90/95). | `lib/calibrated/mortality.json` |
| `python3 -m research.regimes` | Fits a **Regime-Switching Lognormal (Hardy RSLN-2)** — the actuarial reserving standard — to S&P 500 annual returns 1928–2024 by EM (`statsmodels.MarkovRegression`). Captures volatility clustering / the fat left tail. | `lib/calibrated/regimes.json` |
| `python3 -m research.validate` | **Validation harness.** Runs one austere withdrawal model through five independent return engines (normal i.i.d., Student-t, regime-switching, historical block-bootstrap, deterministic anchor), all calibrated to the same first two moments, and confirms they agree on success rate / terminal wealth / tail. | `research/out/validation.json` |
| `research/data.py` | The verified 97-year Damodaran dataset (S&P, 10-yr Treasury, T-bill, CPI 1928–2024) as numpy arrays. Imported by the others. | — |

## Calibrated results (current)

**Mortality (Gompertz, SSA 2021).** Life expectancy below is COMPLETE (curtate + ½, matching SSA reporting):
- Male: m=85.07, b=11.18 — LE@65 ≈ 83.2, P(reach 90)=25%, P(reach 95)=10%
- Female: m=88.26, b=10.43 — LE@65 ≈ 85.4, P(reach 90)=34%, P(reach 95)=16%
- Blended: m=86.67, b=10.92 (fit to the 50/50 male/female survival MIXTURE, not an average of the two parameter pairs) — LE@65 ≈ 84.3
- Fit RMSE < 0.005 against the published survivorship column.

**Regimes (RSLN-2, S&P 1928–2024):**
- Bull: mean +16.0%/yr (±2.6% SE), vol 15.9%, stays 91% → ~11.6-year spells (~88% of years)
- Bear: mean −19.7%/yr (±7.7% SE), vol 13.3%, stays 36% → ~1.6-year spells (~12% of years)
- Blended long-run mean 11.8% (matches the raw historical 11.79%); mixture vol 19.4%.
- The bear is the *negative-mean, persistent-clustering* regime — NOT a higher-volatility one (its within-regime vol is actually a touch lower than the bull's). The fat left tail comes from regime switching on the mean + the between-regime mean gap, not bear-state vol. The bear is identified from only ~11 of 97 years, so its parameters carry wide error bars (hence the reported SEs).

**Validation (4.5% real withdrawal, 30 yr, single equity sleeve).** Every engine is affine-standardized to the SAME forward mean (7.94%) and vol (16.47%), so the only thing that differs is distribution SHAPE / serial dependence:

| Engine | Success | Median terminal (× start) | ES25 (worst-quartile mean) | Median depletion year |
|---|---|---|---|---|
| Normal i.i.d. | 86.5% | 2.47 | 0.16 | 23 |
| Student-t df6 (the app's engine) | 86.3% | 2.49 | 0.15 | 23 |
| Regime-switching | 82.6% | 2.53 | 0.07 | 21 |
| Historical bootstrap | 87.6% | 2.48 | 0.19 | 23 |
| Deterministic anchor | 100% | 2.57 | 2.57 | — |

Success-rate spread across the four stochastic engines: **5.0%** — tight. The
app's Student-t engine sits in the middle of the pack (not an optimistic
outlier). The regime-switching model's lower success (and lowest ES25, and
*earlier* median depletion, year 21 vs 23) is the expected sequence-of-returns
penalty from volatility clustering — visible specifically in the left tail, at
the same mean and vol as the others. (ES is measured at the worst 25%, not 10%:
because >10% of paths deplete to exactly 0 at this withdrawal rate, a worst-10%
mean would be a degenerate constant 0 and couldn't discriminate the engines.)
This is the "compare against alternatives" discipline a reviewing actuary/CFA
expects.

## How this connects to the app

- `lib/calibrated/mortality.json` → consumed by `lib/mortality.ts` for the
  survival-aware longevity planning on the Forecast page.
- `lib/calibrated/regimes.json` → available to the TS Monte-Carlo as an optional
  regime-switching engine and documented in the methodology.
- `research/out/validation.json` → the evidence the methodology is sound; the
  headline numbers are surfaced in the app's methodology / Learn copy.

Re-run any module after updating source data; commit the regenerated JSON.
