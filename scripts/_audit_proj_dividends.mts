/**
 * AUDIT PROBE 7 — Dividend carve-out, basis behavior, interest crediting.
 *  A) "spend" mode: brokerage-only household, 100% qualified dividends — hand-roll
 *     3 years of balances (carve-out after growth, scaled by start-of-year balance).
 *  B) Basis unchanged by the carve-out (endingBuckets.taxableGain hand check).
 *  C) shareFraction: only sales move dividends (holdings-based household).
 *  D) "reinvest" mode + CASH interest: the taxed interest is credited to the cash
 *     account each year (hand-rolled balance check; no vanished income).
 *  E) "reinvest" mode dividends: retained after-tax dividends step up cost basis
 *     (hand-rolled basis check; embedded gain no longer overstated).
 *
 * Run: npx tsx scripts/_audit_proj_dividends.mts
 */
import { projectLifetime, fmt, toAssumptions, DEFAULT_INPUTS, adjustedAnnualBenefit } from "./audit-kit.mts";

let bad = 0;
const chk = (cond: boolean, msg: string) => { if (!cond) { bad++; console.log("FAIL: " + msg); } };
const year = new Date().getFullYear();
const noSurv = { ...DEFAULT_INPUTS, survivor: null };

// A+B) spend mode hand-roll: SS covers all spending → zero withdrawals; r=5%.
{
  const hh: any = {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 60_000, ssClaimAge: 62 },
    spouse: { label: "B", birthYear: year - 66, socialSecurityAnnual: 60_000, ssClaimAge: 62 },
    pensionAnnual: 0, annualSpending: 30_000, brokerageDividendsAnnual: 20_000, state: "IL",
    accounts: [{ id: "b", label: "", kind: "brokerage", owner: "self", balance: 1_000_000, costBasis: 400_000 }],
  };
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...noSurv, endAge: 68 }, { dividendMode: "spend", inflationRate: 0 }) as any;
  const p = projectLifetime(hh, A);
  // netCash > target every year → surplus reinvested into the brokerage (with basis).
  // Hand-roll: B0=1,000,000. div_t = 20,000 × B_t/1,000,000. surplus_t = SS + div_t − tax_t − 30,000 (no irmaa yet: ages 66/66? 66>=65 → 2 enrollees, but MAGI low → $0 surcharge)
  let B = 1_000_000, basis = 400_000;
  for (let i = 0; i < p.rows.length; i++) {
    const r: any = p.rows[i];
    const div = 20_000 * (B / 1_000_000);
    const ssAdj = p.rows[0].netCash + p.rows[0].tax - (r.fromPretax + r.fromTaxable + r.fromRoth) - div; // derive from row identity year 1 only
    // simpler: use row identity directly: netCash = SS + div − tax  (draws are 0)
    chk(r.fromPretax + r.fromTaxable + r.fromRoth < 0.01, `y${i}: unexpected draws`);
    const surplus = r.netCash - r.spendingTarget - r.irmaa;
    const reinvest = Math.max(0, surplus);
    // engine order: draws, reinvest surplus, grow, carve out dividends
    B = (B + reinvest) * 1.05 - div;
    basis += reinvest;
    const next: any = p.rows[i + 1];
    if (next) chk(Math.abs(next.startBalances.taxable - B) < 1, `y${i + 1} taxable ${fmt(next.startBalances.taxable)} want ${fmt(B)}`);
  }
  chk(Math.abs(p.endingBuckets.taxable - B) < 1, `end taxable ${fmt(p.endingBuckets.taxable)} want hand-rolled ${fmt(B)}`);
  chk(Math.abs(p.endingBuckets.taxableGain - Math.max(0, B - basis)) < 1, `end gain ${fmt(p.endingBuckets.taxableGain)} want ${fmt(Math.max(0, B - basis))} (carve-out must NOT touch basis)`);
  console.log(`A/B spend-mode hand-roll: end taxable ${fmt(B)}, basis ${fmt(basis)}, gain ${fmt(B - basis)} ✓`);
}

// C) shareFraction: holdings-based dividends shouldn't move with price, only with sales.
{
  const hh: any = {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 80_000, ssClaimAge: 62 },
    spouse: { label: "B", birthYear: 1900, socialSecurityAnnual: 0, ssClaimAge: 62 },
    pensionAnnual: 0, annualSpending: 20_000, brokerageDividendsAnnual: 0, state: "IL",
    accounts: [{
      id: "b", label: "", kind: "brokerage", owner: "self", balance: 0, costBasis: 0,
      holdings: [{ ticker: "X", name: "X", type: "etf", shares: 10_000, price: 100, costPerShare: 50, dividendPerShare: 3, dividendGrowthRate: 0 }],
    }],
  };
  hh.accounts[0].balance = 1_000_000; hh.accounts[0].costBasis = 500_000;
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...noSurv, endAge: 70 }, { dividendMode: "spend", inflationRate: 0 }) as any;
  const p = projectLifetime(hh, A);
  // SS covers spending; no sales; surplus REINVESTED → shareFraction grows with reinvestment
  // dividend y0 = 30_000; must not fall as price grows; grows only via reinvested-surplus share purchases.
  const ssAdj = adjustedAnnualBenefit(80_000, hh.self.birthYear, 62); // claimed at 62 → ~70% of PIA
  const div0 = p.rows[0].netCash + p.rows[0].tax - ssAdj; // netCash = SS + div − tax
  chk(Math.abs(div0 - 30_000) < 1, `holdings div y0 ${fmt(div0)} want $30,000`);
  const i5 = Math.min(4, p.rows.length - 1);
  const div5 = p.rows[i5].netCash + p.rows[i5].tax - ssAdj;
  console.log(`C shareFraction: div y0 ${fmt(div0)}, y4 ${fmt(div5)} (growth from reinvested surplus only; price never cuts it)`);
  chk(div5 >= div0 - 1, "dividends must not decay without sales");
}

// D) reinvest mode: taxed cash interest must be CREDITED to the cash account
//    (fixed — it used to vanish: taxed, then added to no balance). Hand-roll the
//    cash balance year by year: cash_{t+1} = cash_t + 40k×(cash_t/1M) − taxableDraw_t.
{
  const hh: any = {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 60_000, ssClaimAge: 62 },
    spouse: { label: "B", birthYear: year - 66, socialSecurityAnnual: 60_000, ssClaimAge: 62 },
    pensionAnnual: 0, annualSpending: 100_000, brokerageDividendsAnnual: 0,
    taxableInterestAnnual: 40_000, state: "IL", // $1M cash at 4%
    accounts: [
      { id: "c", label: "", kind: "cash", owner: "self", balance: 1_000_000, costBasis: 1_000_000 },
      { id: "p", label: "", kind: "traditional_ira", owner: "self", balance: 1_000_000 },
    ],
  };
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...noSurv, endAge: 85 }, {}) as any;
  const pReinvest = projectLifetime(hh, A);
  const pSpend = projectLifetime(hh, { ...A, dividendMode: "spend" });
  // Hand-roll the taxable bucket = cash + (RMD-surplus) brokerage. Engine order:
  // draws (cash-first) → surplus reinvested into a BROKERAGE (created on demand) /
  // premium drawn → growth (brokerage only) → interest credited to cash, where
  // interest_t = 40k × startCash_t/1M (the intF scaling).
  let cash = 1_000_000, brok = 0;
  for (let i = 0; i < pReinvest.rows.length; i++) {
    const r: any = pReinvest.rows[i];
    chk(Math.abs(r.startBalances.taxable - (cash + brok)) < 1, `D y${i}: taxable ${fmt(r.startBalances.taxable)} want hand-rolled ${fmt(cash + brok)}`);
    const interest = 40_000 * (cash / 1_000_000);
    const drawCashFirst = (amt: number) => {
      const fromCash = Math.min(cash, amt);
      cash -= fromCash;
      brok = Math.max(0, brok - (amt - fromCash));
    };
    drawCashFirst(r.fromTaxable);
    const leftover = r.netCash - r.spendingTarget;
    const reinv = Math.max(0, leftover - r.irmaa);
    const prem = Math.max(0, r.irmaa - Math.max(0, leftover));
    brok += reinv; // strictly the brokerage — never parked in cash
    if (prem > 0) drawCashFirst(prem);
    brok *= 1.05;
    cash += interest; // the credit under test: taxed interest lands back in cash
  }
  chk(Math.abs(pReinvest.endingBuckets.taxable - (cash + brok)) < 1, `D end taxable ${fmt(pReinvest.endingBuckets.taxable)} want ${fmt(cash + brok)} (interest credited, none vanishes)`);
  // The reinvest-vs-spend gap used to be ~$983k of VANISHED interest; now the only
  // difference is asset location (retained interest sits in 0%-growth cash, while
  // spend-mode surplus is reinvested into a growing brokerage).
  const gap = pSpend.endingEstate - pReinvest.endingEstate;
  console.log(`D interest credit: endingEstate reinvest ${fmt(pReinvest.endingEstate)} vs spend ${fmt(pSpend.endingEstate)} (gap ${fmt(gap)}; was ~$983k when interest vanished)`);
  console.log(`   reinvest-mode y0: tax ${fmt(pReinvest.rows[0].tax)}, netCash ${fmt(pReinvest.rows[0].netCash)}, draws ${fmt(pReinvest.rows[0].fromPretax + pReinvest.rows[0].fromTaxable)}`);
  chk(gap < 350_000, `D: reinvest-vs-spend gap ${fmt(gap)} still leak-sized (interest not credited?)`);
}

// E) reinvest mode: retained (already-taxed) dividends must STEP UP cost basis
//    (fixed — basis used to stay put, double-taxing every retained dividend as
//    unrealized gain later). Hand-roll: basis_{t+1} = basis_t + surplus_t + div_t.
{
  const hh: any = {
    self: { label: "A", birthYear: year - 66, socialSecurityAnnual: 80_000, ssClaimAge: 62 },
    spouse: { label: "B", birthYear: year - 66, socialSecurityAnnual: 80_000, ssClaimAge: 62 },
    pensionAnnual: 0, annualSpending: 100_000, brokerageDividendsAnnual: 30_000, state: "IL", // 3% yield
    accounts: [{ id: "b", label: "", kind: "brokerage", owner: "self", balance: 1_000_000, costBasis: 1_000_000 }], // zero embedded gain today
  };
  const A = toAssumptions({ strategy: "conventional", bracketTarget: 0.22, conv: false }, { ...noSurv, endAge: 90 }, { returnRate: 0.05 }) as any;
  const p = projectLifetime(hh, A);
  // Basis = initial 1M + every reinvested surplus + every retained dividend
  // (div_t = 30k × startTaxable_t/1M — the divF scaling; cap at balance never
  // binds here since balance also compounds at 5%). Requires zero taxable draws
  // so basis is never scaled down by a sale.
  let basisExp = 1_000_000;
  let cumRetained = 0;
  for (const r of p.rows as any[]) {
    chk(r.fromTaxable < 0.01, `E y${r.year}: unexpected taxable draw ${fmt(r.fromTaxable)} (hand-roll assumes none)`);
    const div = 30_000 * (r.startBalances.taxable / 1_000_000);
    const surplus = Math.max(0, r.netCash - r.spendingTarget - r.irmaa);
    basisExp += surplus + div;
    cumRetained += div;
  }
  const gainExp = Math.max(0, p.endingBuckets.taxable - basisExp);
  chk(Math.abs(p.endingBuckets.taxableGain - gainExp) < 1, `E gain ${fmt(p.endingBuckets.taxableGain)} want ${fmt(gainExp)} (retained dividends must raise basis)`);
  console.log(`E basis step-up: end taxable ${fmt(p.endingBuckets.taxable)}, embedded gain ${fmt(p.endingBuckets.taxableGain)} (was ${fmt(p.endingBuckets.taxableGain + cumRetained)} pre-fix); cumulative retained dividends ${fmt(cumRetained)} now in basis`);
}

console.log(bad === 0 ? "\nDIVIDEND checks: ALL PASS (see D/E notes above)" : `\nDIVIDEND checks: ${bad} FAILURES`);
