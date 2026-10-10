/**
 * One-shot: verify every ondoEquity / xStock / key deployment in seed-assets.ts against LI.FI.
 * Usage: node scripts/verify-seed-lifi.mjs
 */
import { readFile } from "node:fs/promises";

const LIFI = {
  ethereum: 1,
  base: 8453,
  bnb: 56,
  arbitrum: 42161,
  polygon: 137,
  solana: 1151111081099710,
};

const sym = (s) => s.trim().toUpperCase();

const src = await readFile(new URL("../apps/api/src/ops/seed-assets.ts", import.meta.url), "utf8");
const start = src.indexOf("const SEED");
const end = src.indexOf("];", start);
const block = src.slice(start, end);

const ondo = [...block.matchAll(/ondoEquity\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)].map((m) => ({
  symbol: sym(m[2]),
  chain: "ethereum",
  address: m[3].toLowerCase(),
  decimals: 18,
  aliases: [],
}));

const xstocks = [...block.matchAll(/xStock\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)].map((m) => ({
  symbol: sym(m[2]),
  chain: "solana",
  address: m[3],
  decimals: 8,
  aliases: [],
}));

const extras = [
  { symbol: "LINK", chain: "base", address: "0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196", decimals: 18, aliases: [] },
  { symbol: "USDT", chain: "arbitrum", address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6, aliases: ["USDT0"] },
  { symbol: "USDY", chain: "ethereum", address: "0x96f6ef951840721adbf46ac996b59e0235cb985c", decimals: 18, aliases: [] },
  { symbol: "OUSG", chain: "ethereum", address: "0x1b19c19393e2d034d8ff31ff34c81252fcbbee92", decimals: 18, aliases: [] },
];

const all = [...ondo, ...xstocks, ...extras];
let bad = 0;

for (const row of all) {
  const url = `https://li.quest/v1/token?chain=${LIFI[row.chain]}&token=${encodeURIComponent(row.address)}`;
  const body = await (await fetch(url)).json();
  const allowed = new Set([row.symbol, ...row.aliases.map(sym)]);
  const ok = body.symbol && allowed.has(sym(body.symbol)) && body.decimals === row.decimals;
  if (!ok) {
    bad += 1;
    console.log("BAD", row.symbol, row.chain, row.address, "got", body.symbol, body.decimals, body.message);
  } else {
    console.log("OK ", row.symbol.padEnd(10), row.chain.padEnd(10), body.symbol);
  }
}

console.log(bad ? `FAILED ${bad}/${all.length}` : `ALL OK (${all.length})`);
process.exitCode = bad ? 1 : 0;
