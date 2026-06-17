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

**Mortality (Gompertz, SSA 2021):**
- Male: m=85.07, b=11.18 — life expectancy at 65 ≈ 82.7, P(reach 90)=25%, P(reach 95)=10%
- Female: m=88.26, b=10.43 — LE@65 ≈ 84.9, P(reach 90)=34%, P(reach 95)=16%
- Blended: m=86.66, b=10.80
- Fit RMSE < 0.005 against the published survivorship column.

**Regimes (RSLN-2, S&P 1928–2024):**
- Bull: mean +16.0%/yr, vol 15.9%, persists 91% of the time (~88% of years)
- Bear: mean −19.7%/yr, vol 13.3%, persists 36% (~12% of years)
- Blended long-run mean 11.8% — matches the raw historical 11.79%.

**Validation (4.5% real withdrawal, 30 yr, single equity sleeve, moments matched to the forward CMA):**

| Engine | Success | Median terminal (× start) |
|---|---|---|
| Normal i.i.d. | 86.5% | 2.47 |
| Student-t df6 (the app's engine) | 86.3% | 2.49 |
| Regime-switching | 82.6% | 2.53 |
| Historical bootstrap | 87.6% | 2.48 |
| Deterministic anchor | 100% | 2.57 |

Success-rate spread across the four stochastic engines: **5.0%** — tight. The
app's Student-t engine sits in the middle of the pack (not an optimistic
outlier), and the regime-switching model's lower success is the expected
sequence-of-returns penalty from volatility clustering. This is the
"compare against alternatives" discipline a reviewing actuary/CFA expects.

## How this connects to the app

- `lib/calibrated/mortality.json` → consumed by `lib/mortality.ts` for the
  survival-aware longevity planning on the Forecast page.
- `lib/calibrated/regimes.json` → available to the TS Monte-Carlo as an optional
  regime-switching engine and documented in the methodology.
- `research/out/validation.json` → the evidence the methodology is sound; the
  headline numbers are surfaced in the app's methodology / Learn copy.

Re-run any module after updating source data; commit the regenerated JSON.
