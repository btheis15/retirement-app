/** Citation registry. Every recommendation points at an authoritative source so
 *  the "why" is verifiable. Keep URLs to primary sources (IRS / SSA / CMS). */

export interface Source {
  label: string;
  url: string;
}

export const SOURCES = {
  rmd: { label: "IRS Pub. 590-B — RMDs & IRA distributions", url: "https://www.irs.gov/publications/p590b" },
  rmdAge: {
    label: "SECURE 2.0 Act — RMD age 73/75",
    url: "https://www.irs.gov/retirement-plans/retirement-plans-faqs-regarding-required-minimum-distributions",
  },
  rothNoRmd: {
    label: "IRS — Roth IRAs have no lifetime RMDs for the owner",
    url: "https://www.irs.gov/retirement-plans/retirement-plans-faqs-on-designated-roth-accounts",
  },
  rothConversion: { label: "IRS Pub. 590-A — Roth conversions", url: "https://www.irs.gov/publications/p590a" },
  ssTax: { label: "IRS Pub. 915 — Taxability of Social Security", url: "https://www.irs.gov/publications/p915" },
  capGains: { label: "IRS Topic 409 — Capital gains & the 0%/15%/20% rates", url: "https://www.irs.gov/taxtopics/tc409" },
  brackets2026: {
    label: "IRS Rev. Proc. 2025-32 — 2026 inflation-adjusted brackets & deductions",
    url: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
  },
  niit: { label: "IRS — Net Investment Income Tax (Form 8960)", url: "https://www.irs.gov/taxtopics/tc559" },
  irmaa: { label: "Medicare.gov — IRMAA Part B & D income surcharges", url: "https://www.medicare.gov/basics/costs/medicare-costs" },
  qcd: { label: "IRS — Qualified Charitable Distributions", url: "https://www.irs.gov/newsroom/reminder-to-ira-owners-age-70-and-a-half-or-over-qualified-charitable-distributions-are-great-options-for-making-tax-free-gifts-to-charity" },
  seniorDeduction: {
    label: "IRS — Additional standard deduction for age 65+ (and 2025–2028 senior bonus)",
    url: "https://www.irs.gov/credits-deductions/individuals/standard-deduction",
  },
  stepUp: { label: "IRS — Cost basis step-up at death (inherited property)", url: "https://www.irs.gov/taxtopics/tc703" },
  ssClaimEarly: { label: "SSA — Early retirement benefit reduction (claiming before FRA)", url: "https://www.ssa.gov/benefits/retirement/planner/agereduction.html" },
  ssDelayed: { label: "SSA — Delayed retirement credits (waiting past FRA to age 70)", url: "https://www.ssa.gov/benefits/retirement/planner/delayret.html" },
  ssSurvivor: { label: "SSA — Survivors benefits (survivor keeps the larger benefit)", url: "https://www.ssa.gov/benefits/survivors/" },
  ssEarningsTest: {
    label: "SSA — Receiving benefits while working (the retirement earnings test)",
    url: "https://www.ssa.gov/benefits/retirement/planner/whileworking.html",
  },
  filingStatus: { label: "IRS — Filing status (Single vs. Married Filing Jointly)", url: "https://www.irs.gov/filing/individuals/how-to-file" },
  inheritedIra: { label: "IRS — Inherited IRA & the SECURE Act 10-year rule", url: "https://www.irs.gov/retirement-plans/required-minimum-distributions-for-ira-beneficiaries" },
  nua: { label: "IRS — Net Unrealized Appreciation on employer stock (Pub. 575)", url: "https://www.irs.gov/publications/p575" },
  aca: { label: "HealthCare.gov — Premium tax credit (income-based ACA subsidy)", url: "https://www.healthcare.gov/lower-costs/save-on-monthly-premiums/" },
  realEstate: { label: "IRS — Depreciation & §1031 like-kind exchanges (Pub. 527 / Topic 409)", url: "https://www.irs.gov/publications/p527" },
  fees: { label: "SEC Investor.gov — How fees & expenses eat into returns", url: "https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator" },
  fiduciary: { label: "SEC Investor.gov — Working with an investment professional (fiduciary, how they're paid)", url: "https://www.investor.gov/introduction-investing/getting-started/working-investment-professional" },
  annuitiesSEC: { label: "SEC Investor.gov — Annuities (types, fees, surrender charges)", url: "https://www.investor.gov/introduction-investing/investing-basics/investment-products/insurance-products/annuities" },
  ilRetirement: {
    label: "IL Dept. of Revenue Pub-120 — retirement income subtraction (incl. Roth conversions)",
    url: "https://tax.illinois.gov/content/dam/soi/en/web/tax/research/publications/pubs/documents/pub-120.pdf",
  },
  ilRate: { label: "IL Dept. of Revenue — individual income tax rate & exemptions", url: "https://tax.illinois.gov/research/taxrates/income.html" },
  monteCarlo: {
    label: "T. Rowe Price — How a Monte Carlo analysis works in retirement planning",
    url: "https://www.troweprice.com/personal-investing/resources/insights/how-monte-carlo-analysis-could-improve-your-retirement-plan.html",
  },
  cma: {
    label: "Vanguard Capital Markets Model — forward-looking return, volatility & correlation forecasts",
    url: "https://corporate.vanguard.com/content/corporatesite/us/en/corp/vemo/vemo-return-forecasts.html",
  },
  histReturns: {
    label: "Damodaran (NYU Stern) — historical returns on stocks, bonds & bills, 1928–present",
    url: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html",
  },
  fidelityPositions: {
    label: "Fidelity — exporting your account/positions information",
    url: "https://www.fidelity.com/customer-service/faqs-exporting-account-information",
  },
  schwabPositions: {
    label: "Schwab — Positions page (the Export link lives at the top right)",
    url: "https://client.schwab.com/app/accounts/positions",
  },
  vanguardDownload: {
    label: "Vanguard — Download center (spreadsheet-compatible CSV)",
    url: "https://personal.vanguard.com/us/DownloadCenter",
  },
} as const;
