/**
 * AUDIT PROBE — the mix-derived return options (lib/returnOptions.ts +
 * historicalGeometric in lib/returnsHistorical.ts).
 * Run: npx tsx scripts/_audit_returns_options.mts
 *
 * Hand math / anchors:
 *  - All-stock history 1928–2024: the S&P 500's compound (geometric) nominal
 *    return is famously ≈10%/yr (Damodaran's series ⇒ ~9.9%). Window 9.5–10.5%.
 *  - All-bond (10-yr Treasury) compound ≈4.6%/yr ⇒ window 4.2–5.2%.
 *  - All-bills compound ≈3.3%/yr ⇒ window 3.0–3.8%.
 *  - 70/25/5 forward CMAs (returns.ts): expected = .7×7.94 + .25×4.91 + .05×3.10
 *    = 6.94% → round 6.9%; vol from the full covariance ≈ 11.8%; geometric =
 *    6.9 − 11.8²/2 ≈ 6.2%; optimistic = 6.2 + 1.5 + .7×1.0 = 8.4%.
 *  - The user-facing invariant behind the wave: for stock-heavy mixes the
 *    HIGHEST option (History repeated) must not sit below the mix's historical
 *    average — it IS the historical average, and it must top the forward cards.
 */
import { returnModel } from "../lib/returns.ts";
import { historicalGeometric } from "../lib/returnsHistorical.ts";
import { buildReturnOptions, matchReturnChoice, resolveReturnRate, describeMix, RETURN_MATCH_EPS } from "../lib/returnOptions.ts";
import type { Account, Holding } from "../lib/accounts.ts";

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
};

const h = (type: Holding["type"], value: number): Holding =>
  ({ ticker: "X", name: "x", type, shares: 1, price: value }) as Holding;
const acct = (holdings: Holding[]): Account =>
  ({ id: "a1", label: "t", kind: "brokerage", owner: "self", balance: 0, holdings }) as Account;

// ── historicalGeometric windows ──────────────────────────────────────────────
const stock = historicalGeometric({ equityPct: 1, bondPct: 0, cashPct: 0 });
const bond = historicalGeometric({ equityPct: 0, bondPct: 1, cashPct: 0 });
const bill = historicalGeometric({ equityPct: 0, bondPct: 0, cashPct: 1 });
const mix705 = historicalGeometric({ equityPct: 0.7, bondPct: 0.25, cashPct: 0.05 });
check("all-stock history ≈ the famous ~10%", stock >= 0.095 && stock <= 0.105, `${(stock * 100).toFixed(1)}%`);
check("all-bond history ≈ 4.2–5.2%", bond >= 0.042 && bond <= 0.052, `${(bond * 100).toFixed(1)}%`);
check("all-bills history ≈ 3.0–3.8%", bill >= 0.03 && bill <= 0.038, `${(bill * 100).toFixed(1)}%`);
check("70/25/5 history between bond-only and stock-only", mix705 > bond && mix705 < stock, `${(mix705 * 100).toFixed(1)}%`);
check("rounded to 0.1% steps", Math.abs(stock * 1000 - Math.round(stock * 1000)) < 1e-9);

// ── all-stock portfolio: cards + the headline invariant ─────────────────────
const rmStock = returnModel([acct([h("stock", 100_000)])]);
check("all-stock mix read", rmStock.equityPct === 1 && rmStock.bondPct === 0);
const optsStock = buildReturnOptions(rmStock);
const hs = optsStock.find((o) => o.choice === "historical")!;
const st = optsStock.find((o) => o.choice === "strong")!;
check("all-stock: History repeated is the top card", hs.rate > st.rate, `hist ${hs.rate} vs strong ${st.rate}`);
check(
  "all-stock: no option is 'way below the market average' — top card IS the ~10% average",
  hs.rate >= 0.095,
  `${(hs.rate * 100).toFixed(1)}%`,
);
check("resolve(expected) = expectedGeometric", resolveReturnRate(rmStock, "expected") === rmStock.expectedGeometric);
check("resolve(cautious/strong) = brackets", resolveReturnRate(rmStock, "cautious") === rmStock.conservative && resolveReturnRate(rmStock, "strong") === rmStock.optimistic);

// ── 70/25/5 portfolio (the assumed default mix) ─────────────────────────────
const rmMix = returnModel([acct([h("stock", 70_000), h("bond_fund", 25_000), h("cash", 5_000)])]);
check("70/25/5 weights", Math.abs(rmMix.equityPct - 0.7) < 1e-9 && Math.abs(rmMix.bondPct - 0.25) < 1e-9);
check("70/25/5 expected 6.9% (hand math)", rmMix.expected === 0.069, `${rmMix.expected}`);
check("70/25/5 geometric 6.2% (hand math)", rmMix.expectedGeometric === 0.062, `${rmMix.expectedGeometric}`);
check("70/25/5 optimistic 8.4% (hand math)", rmMix.optimistic === 0.084, `${rmMix.optimistic}`);
const histMix = resolveReturnRate(rmMix, "historical");
check("70/25/5: history tops the forward cards", histMix >= rmMix.optimistic, `hist ${histMix} vs opt ${rmMix.optimistic}`);

// ── choice matching: every card round-trips; off-card rates stay custom ─────
for (const o of buildReturnOptions(rmMix)) {
  check(`roundtrip ${o.choice}`, matchReturnChoice(rmMix, o.rate) === o.choice, `${o.rate}`);
}
check("far-off rate matches nothing (stays custom)", matchReturnChoice(rmMix, 0.2) === null);
// Adoption semantics: a saved rate only ever ADOPTS a card it already (nearly)
// equals — so adopting never meaningfully moves the number, it just starts
// tracking the mix. For this mix the old 4% preset coincides with Cautious
// (0.062−0.015−0.007 = 0.040 exactly) → adopted; the old 5% preset matches no
// card → stays custom forever.
check("legacy 5% preset stays custom (no card within 0.25%)", matchReturnChoice(rmMix, 0.05) === null, `eps ${RETURN_MATCH_EPS}`);
check("legacy 4% preset == this mix's Cautious card → adopted, number unmoved", matchReturnChoice(rmMix, 0.04) === "cautious" && rmMix.conservative === 0.04);

// ── labels & mix description ────────────────────────────────────────────────
const labels = buildReturnOptions(rmMix).map((o) => o.label).join("|");
check("labels", labels === "Cautious|Expected|Strong|History repeated", labels);
check("exactly one suggested card (Expected ★)", buildReturnOptions(rmMix).filter((o) => o.suggested).length === 1 && buildReturnOptions(rmMix).find((o) => o.suggested)!.choice === "expected");
check("describeMix", describeMix(rmMix) === "70% stocks · 25% bonds · 5% cash", describeMix(rmMix));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
