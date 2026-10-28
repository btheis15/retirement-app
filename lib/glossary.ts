/** Plain-English glossary of the jargon a retiree meets in this app (2026 US federal rules).
 *  Pure data. Rendered by components/Term.tsx (popover) and the Glossary on the Learn tab. */

export interface GlossaryEntry {
  id: string;
  term: string;
  /** One plain sentence, grade-8 reading level, 30 words or fewer. */
  short: string;
  /** Optional extra sentence on why it matters to the reader. */
  why?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { id: "rmd", term: "RMD (required minimum distribution)", short: "A yearly amount the IRS makes you withdraw from pre-tax retirement accounts, starting at age 73 (75 if you were born in 1960 or later).", why: "RMDs are taxed as ordinary income, so large ones can push you into a higher bracket." },
  { id: "irmaa", term: "IRMAA", short: "An extra charge added to Medicare Part B and Part D premiums when your income is above certain levels.", why: "It uses your income from two years earlier, and one dollar over a limit triggers the whole higher tier." },
  { id: "magi", term: "MAGI (modified adjusted gross income)", short: "Your adjusted gross income plus a few add-backs, such as tax-exempt interest. Medicare uses it to set your IRMAA surcharge.", why: "Keeping MAGI under a threshold can save thousands a year in Medicare premiums." },
  { id: "roth-conversion", term: "Roth conversion", short: "Moving money from a pre-tax account to a Roth account and paying income tax on it now, so it grows and is withdrawn tax-free later.", why: "It can shrink future RMDs and lower the tax bill for a surviving spouse or heirs." },
  { id: "pretax", term: "Pre-tax (traditional) account", short: "A traditional IRA or 401(k). You skipped tax when you put money in, so withdrawals are taxed as ordinary income.", why: "These accounts are what create RMDs." },
  { id: "brokerage", term: "Brokerage (taxable) account", short: "An ordinary investment account with no special tax shelter. You pay tax on dividends and interest, and on gains when you sell.", why: "Selling here is often cheap, because only the gain is taxed, usually at lower capital gains rates." },
  { id: "tax-bracket", term: "Tax bracket", short: "A slice of income taxed at one rate. Only the dollars inside each slice pay that slice's rate, not all of your income.", why: "Filling a low bracket on purpose can be cheaper than being forced into a higher one later." },
  { id: "marginal-rate", term: "Marginal rate", short: "The tax rate on your next dollar of income. It is the rate of the top bracket you reach.", why: "It is the rate to compare when deciding whether to withdraw or convert a little more." },
  { id: "effective-rate", term: "Effective rate", short: "Your total tax divided by your total income. It is the average rate you actually pay, and it is always lower than your top bracket.", why: "It shows the real cost of a plan better than the bracket does." },
  { id: "standard-deduction", term: "Standard deduction", short: "A set amount of income the IRS does not tax. For 2026 it is $32,200 for a married couple filing jointly, with extra at age 65 and older.", why: "Most retirees use it instead of listing deductions one by one." },
  { id: "capital-gains", term: "Capital gains", short: "The profit when you sell an investment for more than you paid. Gains on assets held over a year are taxed at 0%, 15%, or 20%.", why: "In a low-income year, some gains can be taxed at 0% federally." },
  { id: "medicare-b-d", term: "Medicare Part B and Part D", short: "Part B covers doctor and outpatient care. Part D covers prescription drugs. Both have monthly premiums, and higher incomes pay more through IRMAA.", why: "Medicare starts at 65, and the income that sets your premium is from two years earlier." },
  { id: "full-retirement-age", term: "Social Security full retirement age", short: "The age when you get your full Social Security benefit. It is 67 if you were born in 1960 or later. Claiming earlier cuts the check, and waiting past it raises it.", why: "Each year you wait past it, up to age 70, increases your check for life." },
  { id: "monte-carlo", term: "Monte Carlo (market futures)", short: "A test that plays out your retirement 1,000 times with different random market ups and downs, to show how often your money lasts.", why: "It shows the odds and the bad cases, not just one average guess." },
  { id: "estimated-tax", term: "Estimated tax (1040-ES) and safe harbor", short: "Payments you send the IRS during the year when no tax is withheld. Paying 100% of last year's tax (110% if income was over $150,000) means no penalty.", why: "Withholding from IRA withdrawals counts as paid on time all year." },
  { id: "qcd", term: "QCD (qualified charitable distribution)", short: "A gift sent straight from your IRA to a charity, allowed from age 70½. It is left out of your income, and it can count toward your RMD.", why: "It lowers the income that sets your Social Security taxes and IRMAA tier." },
  { id: "widows-penalty", term: "Widow's (widower's) penalty", short: "After one spouse dies, the survivor files as single, with narrower brackets and lower Medicare income limits, so the same income is taxed more.", why: "It is a strong reason to consider Roth conversions while both spouses are alive." },
  { id: "guardrails", term: "Guardrails", short: "A spending rule that lets you spend more after good market years and trim spending after bad ones, instead of a fixed amount.", why: "Small, early trims can keep your money from running out." },
];

const BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return BY_ID[id];
}
