/**
 * Audit LI.FI tokens for Ondo / xStocks / Robinhood-tagged RWAs on Bytesac chains.
 * Usage: node token.mjs
 * Optional: LIFI_API_KEY=… node token.mjs
 *
 * Prefer `tags` containing `rwa` and issuer-shaped names/symbols — not loose substring
 * matches (those falsely hit "Mondo", "Taekwondo", random "backed", etc.).
 */
import { writeFile } from "node:fs/promises";

const API_URL =
  "https://li.quest/v1/tokens?chains=1,8453,56,42161,1151111081099710,137";

const OUTPUT_FILE = "lifi-token-report.json";

const TARGET_CHAINS = {
  1: "Ethereum",
  8453: "Base",
  56: "BNB Chain",
  42161: "Arbitrum One",
  1151111081099710: "Solana",
  137: "Polygon PoS",
};

/** Popular tickers to surface with exact LI.FI symbol (mixed-case as returned). */
const WATCHLIST = [
  "TSLAon",
  "AAPLon",
  "NVDAon",
  "HOODon",
  "CRCLon",
  "MSTRon",
  "GOOGLon",
  "SPYon",
  "QQQon",
  "TSLAx",
  "AAPLx",
  "NVDAx",
  "HOODx",
  "SPYx",
  "QQQx",
  "BRK.Bx",
  "USDY",
  "OUSG",
  "USDC",
  "USDT",
  "WETH",
  "LINK",
  "JUP",
];

function classify(token) {
  const name = String(token.name ?? "");
  const symbol = String(token.symbol ?? "");
  const tags = Array.isArray(token.tags) ? token.tags.map(String) : [];
  // Note: GET /v1/tokens often omits `tags`; GET /v1/token includes them. Name/symbol are the bulk-list signal.
  const hasRwaTag = tags.includes("rwa");

  const ondo = /ondo tokenized/i.test(name) || /\(ondo\b/i.test(name);
  const xstock = /xstock/i.test(name);
  // True Robinhood issuer products — not Ondo HOODon / Backpack HOOD lookalikes.
  const robinhoodIssuer =
    /robinhood/i.test(name) && !/ondo/i.test(name) && !/backpack/i.test(name) && !/xstock/i.test(name);

  return { hasRwaTag, ondo, xstock, robinhoodIssuer };
}

function summarize(token) {
  return {
    name: token.name,
    symbol: token.symbol,
    address: token.address,
    chainId: token.chainId,
    decimals: token.decimals,
    tags: token.tags ?? [],
    verificationStatus: token.verificationStatus ?? null,
  };
}

async function main() {
  const headers = {};
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;

  const response = await fetch(API_URL, { headers });
  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const tokensByChain = data.tokens;
  if (!tokensByChain || typeof tokensByChain !== "object") {
    throw new Error(`Unexpected LI.FI response shape. Top-level keys: ${Object.keys(data).join(", ")}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    note:
      "Classifiers use tags.includes('rwa') plus issuer-shaped name/symbol. Loose keyword counts are omitted on purpose.",
    chains: {},
    watchlistHits: {},
  };

  for (const [chainId, chainName] of Object.entries(TARGET_CHAINS)) {
    const rawTokens = tokensByChain[chainId];
    const chainTokens = Array.isArray(rawTokens) ? rawTokens : [];
    const tokens = [
      ...new Map(
        chainTokens.map((token) => [
          `${token.chainId ?? chainId}:${String(token.address ?? "").toLowerCase()}`,
          token,
        ]),
      ).values(),
    ];

    const ondo = [];
    const xstock = [];
    const robinhoodIssuer = [];
    const rwaTagged = [];

    for (const token of tokens) {
      const c = classify(token);
      if (c.hasRwaTag) rwaTagged.push(summarize(token));
      if (c.ondo) ondo.push(summarize(token));
      if (c.xstock) xstock.push(summarize(token));
      if (c.robinhoodIssuer) robinhoodIssuer.push(summarize(token));
    }

    const bySymbol = new Map(tokens.map((t) => [String(t.symbol), t]));
    const watch = {};
    for (const symbol of WATCHLIST) {
      const hit = bySymbol.get(symbol);
      if (hit) watch[symbol] = summarize(hit);
    }

    report.chains[chainId] = {
      chain_name: chainName,
      total_tokens: tokens.length,
      rwa_tagged_count: rwaTagged.length,
      ondo_count: ondo.length,
      xstock_count: xstock.length,
      robinhood_issuer_count: robinhoodIssuer.length,
      ondo: ondo.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol))),
      xstock: xstock.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol))),
      robinhood_issuer: robinhoodIssuer,
      watchlist: watch,
    };
    report.watchlistHits[chainId] = watch;
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log(`Token audit saved to ${OUTPUT_FILE}`);
  for (const [chainId, row] of Object.entries(report.chains)) {
    console.log(
      `${row.chain_name} (${chainId}): total=${row.total_tokens} rwa=${row.rwa_tagged_count} ondo=${row.ondo_count} xstock=${row.xstock_count} robinhoodIssuer=${row.robinhood_issuer_count} watchlist=${Object.keys(row.watchlist).length}`,
    );
  }
}

main().catch((error) => {
  console.error("Failed to audit LI.FI tokens:", error.message);
  process.exitCode = 1;
});
