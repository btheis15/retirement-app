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
} as const;

export type SourceKey = keyof typeof SOURCES;
