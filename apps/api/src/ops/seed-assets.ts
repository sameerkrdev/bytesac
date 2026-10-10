/**
 * Local/dev seed: inserts well-known natives, tokens, Ondo RWAs/equities and xStocks as ACTIVE instruments.
 * Usage: pnpm --filter api ops:seed-assets -- --user <user-uuid>
 * Idempotent on live deployments (chain + address, or native chain per instrument symbol).
 *
 * Addresses and decimals are checked against LI.FI `GET /v1/token` before insert (non-native).
 * Not for production — production assets go through ops review.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { and, eq, isNull, ne } from "drizzle-orm";
import {
  assetEvents,
  assetIssuers,
  assetProviders,
  db,
  eligibilityRules,
  executionRoutes,
  instrumentDeployments,
  instruments,
  priceReferences,
  users,
} from "@repo/db";
import { z } from "@repo/validator";

type AssetChain = "solana" | "ethereum" | "base" | "bnb" | "arbitrum" | "polygon" | "bitcoin";
type TokenStandard = "native" | "erc20" | "spl" | "spl_token_2022";
type AssetType =
  | "CRYPTO"
  | "STABLECOIN"
  | "TOKENIZED_TREASURY"
  | "TOKENIZED_FUND"
  | "TOKENIZED_EQUITY"
  | "TOKENIZED_OTHER";
type Sector =
  | "store_of_value"
  | "smart_contract_platform"
  | "layer2"
  | "defi"
  | "stablecoin"
  | "rwa_treasury"
  | "rwa_equity"
  | "other";

type DeploymentSpec = {
  chain: AssetChain;
  tokenStandard: TokenStandard;
  address?: string;
  decimals: number;
  sourceUrl?: string;
  /** Identity-registry / allowlisted tokens — never investable in release 1 (ADR-018). */
  permissioned?: boolean;
  /** Extra LI.FI symbols accepted for this deployment (e.g. Arbitrum USDT labeled USDT0). */
  lifiSymbols?: string[];
};

type InstrumentSpec = {
  name: string;
  symbol: string;
  assetType: AssetType;
  sector: Sector;
  description: string;
  cmcId: string;
  issuerName?: string;
  issuerWebsite?: string;
  deployments: DeploymentSpec[];
  /** RWA: add a permissive eligibility rule so the asset is investable in local/dev. */
  rwa?: boolean;
  routeMethod?: "swap" | "secondary_market";
};

/** LI.FI chain ids used by `GET /v1/token` (see docs.li.fi/introduction/chains). */
const LIFI_CHAIN_ID: Partial<Record<AssetChain, number>> = {
  ethereum: 1,
  base: 8453,
  bnb: 56,
  arbitrum: 42161,
  polygon: 137,
  solana: 1151111081099710,
};

const evm = (address: string) => address.toLowerCase();
/** Match ops createInstrumentRequestSchema: trim + uppercase. */
const sym = (s: string) => s.trim().toUpperCase();

/** Ondo Stocks (Ethereum). `cmcId` is the CoinMarketCap UCID (numeric string). */
const ondoEquity = (name: string, symbol: string, address: string, cmcId: string): InstrumentSpec => ({
  name: `${name} (Ondo Tokenized)`,
  symbol: sym(symbol),
  assetType: "TOKENIZED_EQUITY",
  sector: "rwa_equity",
  description: `Ondo Stocks ${sym(symbol)} — local/dev seed (LI.FI-verified)`,
  cmcId,
  issuerName: "Ondo Global Markets",
  issuerWebsite: "https://ondo.finance",
  rwa: true,
  routeMethod: "secondary_market",
  deployments: [{
    chain: "ethereum",
    tokenStandard: "erc20",
    address: evm(address),
    decimals: 18,
    sourceUrl: "https://docs.ondo.finance/addresses",
  }],
});

/** Backed xStocks (Solana Token-2022). `cmcId` is the CoinMarketCap UCID (numeric string). */
const xStock = (name: string, symbol: string, mint: string, cmcId: string): InstrumentSpec => ({
  name: `${name} xStock`,
  symbol: sym(symbol),
  assetType: "TOKENIZED_EQUITY",
  sector: "rwa_equity",
  description: `Backed xStocks ${sym(symbol)} — local/dev seed (LI.FI-verified)`,
  cmcId,
  issuerName: "Backed (xStocks)",
  issuerWebsite: "https://xstocks.fi",
  rwa: true,
  routeMethod: "secondary_market",
  deployments: [{
    chain: "solana",
    tokenStandard: "spl_token_2022",
    address: mint,
    decimals: 8,
    sourceUrl: "https://assets.backed.fi",
  }],
});

async function assertLifiToken(spec: InstrumentSpec, dep: DeploymentSpec): Promise<void> {
  if (!dep.address || dep.tokenStandard === "native") return;
  const chainId = LIFI_CHAIN_ID[dep.chain];
  if (chainId === undefined) return;
  const url = `https://li.quest/v1/token?chain=${chainId}&token=${encodeURIComponent(dep.address)}`;
  const headers: Record<string, string> = {};
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
  const res = await fetch(url, { headers });
  const body = (await res.json()) as { symbol?: string; decimals?: number; message?: string; verificationStatus?: string };
  if (!res.ok || !body.symbol) {
    throw new Error(`LI.FI token missing for ${spec.symbol} @ ${dep.chain} ${dep.address}: ${body.message ?? res.status}`);
  }
  const allowed = new Set([spec.symbol, ...(dep.lifiSymbols ?? []).map(sym)]);
  if (!allowed.has(sym(body.symbol))) {
    throw new Error(
      `LI.FI symbol mismatch for ${dep.chain} ${dep.address}: seed=${spec.symbol} lifi=${body.symbol} (normalized ${sym(body.symbol)})`,
    );
  }
  if (typeof body.decimals === "number" && body.decimals !== dep.decimals) {
    throw new Error(
      `LI.FI decimals mismatch for ${spec.symbol} @ ${dep.chain}: seed=${dep.decimals} lifi=${body.decimals}`,
    );
  }
}
const SEED: InstrumentSpec[] = [
  {
    name: "Solana",
    symbol: "SOL",
    assetType: "CRYPTO",
    sector: "smart_contract_platform",
    description: "Native SOL",
    cmcId: "5426",
    deployments: [{ chain: "solana", tokenStandard: "native", decimals: 9, sourceUrl: "https://solana.com" }],
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    assetType: "CRYPTO",
    sector: "smart_contract_platform",
    description: "Native ETH across EVM L1/L2s",
    cmcId: "1027",
    deployments: [
      { chain: "ethereum", tokenStandard: "native", decimals: 18, sourceUrl: "https://ethereum.org" },
      { chain: "base", tokenStandard: "native", decimals: 18, sourceUrl: "https://base.org" },
      { chain: "arbitrum", tokenStandard: "native", decimals: 18, sourceUrl: "https://arbitrum.io" },
    ],
  },
  {
    name: "Bitcoin",
    symbol: "BTC",
    assetType: "CRYPTO",
    sector: "store_of_value",
    description: "Native BTC",
    cmcId: "1",
    deployments: [{ chain: "bitcoin", tokenStandard: "native", decimals: 8, sourceUrl: "https://bitcoin.org" }],
  },
  {
    name: "BNB",
    symbol: "BNB",
    assetType: "CRYPTO",
    sector: "smart_contract_platform",
    description: "Native BNB on BNB Chain",
    cmcId: "1839",
    deployments: [{ chain: "bnb", tokenStandard: "native", decimals: 18, sourceUrl: "https://www.bnbchain.org" }],
  },
  {
    name: "Polygon Ecosystem Token",
    symbol: "POL",
    assetType: "CRYPTO",
    sector: "layer2",
    description: "Native POL on Polygon",
    cmcId: "28321",
    deployments: [{ chain: "polygon", tokenStandard: "native", decimals: 18, sourceUrl: "https://polygon.technology" }],
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    assetType: "STABLECOIN",
    sector: "stablecoin",
    description: "Circle USDC",
    cmcId: "3408",
    deployments: [
      { chain: "solana", tokenStandard: "spl", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      { chain: "ethereum", tokenStandard: "erc20", address: evm("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), decimals: 6 },
      { chain: "base", tokenStandard: "erc20", address: evm("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), decimals: 6 },
      { chain: "arbitrum", tokenStandard: "erc20", address: evm("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"), decimals: 6 },
      { chain: "polygon", tokenStandard: "erc20", address: evm("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"), decimals: 6 },
      { chain: "bnb", tokenStandard: "erc20", address: evm("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"), decimals: 18 },
    ],
  },
  {
    name: "Tether USD",
    symbol: "USDT",
    assetType: "STABLECOIN",
    sector: "stablecoin",
    // Arbitrum deployment is the same contract LI.FI now labels USDT0; economic instrument stays USDT.
    description: "Tether USDT",
    cmcId: "825",
    deployments: [
      { chain: "ethereum", tokenStandard: "erc20", address: evm("0xdAC17F958D2ee523a2206206994597C13D831ec7"), decimals: 6 },
      { chain: "bnb", tokenStandard: "erc20", address: evm("0x55d398326f99059fF775485246999027B3197955"), decimals: 18 },
      { chain: "arbitrum", tokenStandard: "erc20", address: evm("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"), decimals: 6, lifiSymbols: ["USDT0"] },
      { chain: "polygon", tokenStandard: "erc20", address: evm("0xc2132D05D31c914a87C6611C10748AEb04B58e8F"), decimals: 6 },
    ],
  },
  {
    name: "Wrapped Ether",
    symbol: "WETH",
    assetType: "CRYPTO",
    sector: "defi",
    description: "WETH",
    cmcId: "2396",
    deployments: [
      { chain: "ethereum", tokenStandard: "erc20", address: evm("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), decimals: 18 },
      { chain: "base", tokenStandard: "erc20", address: evm("0x4200000000000000000000000000000000000006"), decimals: 18 },
      { chain: "arbitrum", tokenStandard: "erc20", address: evm("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"), decimals: 18 },
    ],
  },
  {
    name: "Chainlink",
    symbol: "LINK",
    assetType: "CRYPTO",
    sector: "defi",
    description: "Chainlink",
    cmcId: "1975",
    deployments: [
      { chain: "ethereum", tokenStandard: "erc20", address: evm("0x514910771AF9Ca656af840dff83E8264EcF986CA"), decimals: 18 },
      { chain: "arbitrum", tokenStandard: "erc20", address: evm("0xf97f4df75117a78c1A5a0DBb814Af92458539FB4"), decimals: 18 },
      // Official docs.chain.link/resources/link-token-contracts (Base) — was mistyped as …86Cf63Ced5e
      { chain: "base", tokenStandard: "erc20", address: evm("0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196"), decimals: 18 },
    ],
  },
  {
    name: "Uniswap",
    symbol: "UNI",
    assetType: "CRYPTO",
    sector: "defi",
    description: "Uniswap",
    cmcId: "7083",
    deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: evm("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"), decimals: 18 }],
  },
  {
    name: "PancakeSwap",
    symbol: "CAKE",
    assetType: "CRYPTO",
    sector: "defi",
    description: "PancakeSwap on BNB Chain",
    cmcId: "7186",
    deployments: [{ chain: "bnb", tokenStandard: "erc20", address: evm("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"), decimals: 18 }],
  },
  {
    name: "Jupiter",
    symbol: "JUP",
    assetType: "CRYPTO",
    sector: "defi",
    description: "Jupiter on Solana",
    cmcId: "29210",
    deployments: [{ chain: "solana", tokenStandard: "spl", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 }],
  },
  {
    name: "0x Protocol",
    symbol: "ZRX",
    assetType: "CRYPTO",
    sector: "defi",
    description: "0x Protocol token",
    cmcId: "1896",
    deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: evm("0xE41d2489571d322189246DaFA5ebDe1F4699F498"), decimals: 18 }],
  },
  {
    name: "Ondo US Dollar Yield",
    symbol: "USDY",
    assetType: "TOKENIZED_TREASURY",
    sector: "rwa_treasury",
    description: "Ondo USDY (secondary market; docs.ondo.finance/addresses)",
    cmcId: "27760",
    issuerName: "Ondo Finance",
    issuerWebsite: "https://ondo.finance",
    rwa: true,
    routeMethod: "secondary_market",
    deployments: [{
      chain: "ethereum",
      tokenStandard: "erc20",
      address: evm("0x96F6eF951840721AdBF46Ac996b59E0235CB985C"),
      decimals: 18,
      sourceUrl: "https://docs.ondo.finance/addresses",
    }],
  },
  {
    name: "Ondo Short-Term US Government Treasuries",
    symbol: "OUSG",
    assetType: "TOKENIZED_FUND",
    sector: "rwa_treasury",
    // OndoIDRegistry allowlist — not investable in release 1 (ADR-018 / D-105).
    description: "Ondo OUSG (permissioned identity registry; seeded for ops UI only)",
    cmcId: "32843",
    issuerName: "Ondo Finance",
    issuerWebsite: "https://ondo.finance",
    rwa: true,
    routeMethod: "secondary_market",
    deployments: [{
      chain: "ethereum",
      tokenStandard: "erc20",
      address: evm("0x1B19C19393e2d034D8Ff31ff34c81252FcBbee92"),
      decimals: 18,
      sourceUrl: "https://docs.ondo.finance/addresses",
      permissioned: true,
    }],
  },

  // Ondo Stocks (Ethereum) — LI.FI-verified addresses; CMC UCIDs from coinmarketcap.com.
  ondoEquity("NVIDIA", "NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE", "38093"),
  ondoEquity("Tesla", "TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f", "38029"),
  ondoEquity("Apple", "AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c", "38037"),
  ondoEquity("Microsoft", "MSFTon", "0xB812837b81a3a6b81d7CD74CfB19A7f2784555E5", "38086"),
  ondoEquity("Alphabet Class A", "GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc", "38001"),
  ondoEquity("Meta Platforms", "METAon", "0x59644165402b611b350645555B50Afb581C71EB2", "38065"),
  ondoEquity("Amazon", "AMZNon", "0xbb8774FB97436d23d74C1b882E8E9A69322cFD31", "38083"),
  ondoEquity("SPDR S&P 500 ETF", "SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08", "38067"),
  ondoEquity("Invesco QQQ Trust", "QQQon", "0x0e397938C1Aa0680954093495B70A9F5e2249aBa", "38094"),
  ondoEquity("Broadcom", "AVGOon", "0x0d54D4279B9E8c54cD8547c2C75A8Ee81A0BcaE8", "38062"),
  ondoEquity("Advanced Micro Devices", "AMDon", "0x0C1f3412A44Ff99E40bF14e06e5Ea321aE7B3938", "38027"),
  ondoEquity("Palantir", "PLTRon", "0x0c666485b02F7A87d21AdD7AEb9F5e64975AA490", "38073"),
  // Ondo tokenized HOOD — not Robinhood Chain stock tokens (unsupported asset chain).
  ondoEquity("Robinhood Markets", "HOODon", "0x998f02A9E343EF6E3E6f28700d5A20F839fD74E6", "38004"),
  ondoEquity("Circle Internet Group", "CRCLon", "0x3632DEa96A953C11dac2f00b4A05a32CD1063fAE", "38056"),
  ondoEquity("MicroStrategy", "MSTRon", "0xCabD955322dfbf94C084929ac5E9Eca3fEB5556F", "38092"),

  // Backed xStocks (Solana Token-2022) — LI.FI symbols like TSLAx normalize to TSLAX.
  xStock("NVIDIA", "NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "36992"),
  xStock("Tesla", "TSLAx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "37004"),
  xStock("Apple", "AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "36994"),
  xStock("Microsoft", "MSFTx", "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", "37056"),
  xStock("Alphabet", "GOOGLx", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", "37013"),
  xStock("Meta Platforms", "METAx", "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", "37055"),
  xStock("Amazon", "AMZNx", "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", "37014"),
  xStock("SPDR S&P 500 ETF", "SPYx", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "37006"),
  xStock("Invesco QQQ Trust", "QQQx", "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", "37057"),
  xStock("Broadcom", "AVGOx", "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo", "37021"),
  xStock("Palantir", "PLTRx", "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", "37062"),
  xStock("Netflix", "NFLXx", "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", "37060"),
  xStock("Eli Lilly", "LLYx", "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH", "37038"),
  // LI.FI symbol is BRK.Bx → registry BRK.BX (not BRKBX).
  xStock("Berkshire Hathaway B", "BRK.Bx", "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x", "37020"),
  xStock("Coinbase", "COINx", "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", "36989"),
];
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { user: { type: "string" } },
});
if (!values.user) throw new Error("Pass --user <user-uuid> (an existing signed-in user).");
const userId = z.uuid().parse(values.user);
const requestId = `ops-seed-assets-${randomUUID()}`;

async function ensureIssuer(name: string, website?: string): Promise<string> {
  const [existing] = await db.select({ id: assetIssuers.id }).from(assetIssuers).where(eq(assetIssuers.name, name));
  if (existing) return existing.id;
  const [created] = await db.insert(assetIssuers).values({ name, website: website ?? null }).returning({ id: assetIssuers.id });
  return created!.id;
}

async function ensureProvider(): Promise<string> {
  const [existing] = await db.select({ id: assetProviders.id }).from(assetProviders).where(eq(assetProviders.name, "LI.FI"));
  if (existing) return existing.id;
  const [created] = await db.insert(assetProviders).values({ name: "LI.FI", kind: "dex_aggregator", website: "https://li.fi" }).returning({ id: assetProviders.id });
  return created!.id;
}

async function findLiveDeployment(dep: DeploymentSpec, symbol: string): Promise<string | null> {
  if (dep.address) {
    const [row] = await db.select({ id: instrumentDeployments.id }).from(instrumentDeployments)
      .where(and(eq(instrumentDeployments.chain, dep.chain), eq(instrumentDeployments.address, dep.address), ne(instrumentDeployments.status, "RETIRED")));
    return row?.id ?? null;
  }
  const [row] = await db.select({ id: instrumentDeployments.id }).from(instrumentDeployments)
    .innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(and(
      eq(instruments.symbol, symbol),
      eq(instrumentDeployments.chain, dep.chain),
      eq(instrumentDeployments.tokenStandard, "native"),
      ne(instrumentDeployments.status, "RETIRED"),
    ));
  return row?.id ?? null;
}

async function findOrCreateInstrument(spec: InstrumentSpec, creatorId: string, issuerId: string | null): Promise<string> {
  const [existing] = await db.select({ id: instruments.id }).from(instruments)
    .where(and(eq(instruments.symbol, spec.symbol), ne(instruments.status, "RETIRED")));
  if (existing) return existing.id;
  const [row] = await db.insert(instruments).values({
    name: spec.name,
    symbol: spec.symbol,
    assetType: spec.assetType,
    sector: spec.sector,
    description: spec.description,
    issuerId,
    status: "ACTIVE",
    createdByUserId: creatorId,
    submittedByUserId: creatorId,
    decidedByUserId: creatorId,
  }).returning({ id: instruments.id });
  await db.insert(assetEvents).values({
    instrumentId: row!.id,
    entityType: "instrument",
    entityId: row!.id,
    kind: "activated",
    fromStatus: "DRAFT",
    toStatus: "ACTIVE",
    actorUserId: creatorId,
    message: "Seeded by ops:seed-assets",
    requestId,
  });
  return row!.id;
}

async function ensurePrice(instrumentId: string, cmcId: string): Promise<void> {
  const [existing] = await db.select({ id: priceReferences.id, externalId: priceReferences.externalId }).from(priceReferences)
    .where(and(eq(priceReferences.instrumentId, instrumentId), eq(priceReferences.kind, "market"), eq(priceReferences.status, "ACTIVE")));
  if (existing) {
    // Upgrade seed placeholders in place; never delete the row.
    if (existing.externalId !== cmcId && (existing.externalId?.startsWith("seed-") || !existing.externalId)) {
      await db.update(priceReferences).set({ externalId: cmcId }).where(eq(priceReferences.id, existing.id));
    }
    return;
  }
  await db.insert(priceReferences).values({
    instrumentId,
    kind: "market",
    provider: "coinmarketcap",
    externalId: cmcId,
    quoteCurrency: "USD",
    status: "ACTIVE",
  });
}
async function ensureRoute(
  instrumentId: string,
  deploymentId: string,
  providerId: string,
  creatorId: string,
  method: "swap" | "secondary_market",
): Promise<void> {
  const [existing] = await db.select({ id: executionRoutes.id }).from(executionRoutes)
    .where(and(eq(executionRoutes.deploymentId, deploymentId), ne(executionRoutes.status, "RETIRED")));
  if (existing) return;
  const [route] = await db.insert(executionRoutes).values({
    instrumentId,
    deploymentId,
    providerId,
    venue: "LI.FI",
    method,
    processingModel: "sync",
    status: "ACTIVE",
    approvedByUserId: creatorId,
  }).returning({ id: executionRoutes.id });
  await db.insert(assetEvents).values({
    instrumentId,
    entityType: "route",
    entityId: route!.id,
    kind: "activated",
    toStatus: "ACTIVE",
    actorUserId: creatorId,
    requestId,
  });
}

async function ensureRwaRule(instrumentId: string, sourceUrl: string): Promise<void> {
  const [existing] = await db.select({ id: eligibilityRules.id }).from(eligibilityRules)
    .where(and(eq(eligibilityRules.instrumentId, instrumentId), eq(eligibilityRules.status, "ACTIVE"), isNull(eligibilityRules.routeId)));
  if (existing) return;
  for (const action of ["acquire", "sell"] as const) {
    await db.insert(eligibilityRules).values({
      instrumentId,
      jurisdiction: "*",
      action,
      outcome: "ALLOWED",
      investorStatuses: [],
      sourceText: "Dev seed: permissionless secondary market",
      sourceUrl,
      status: "ACTIVE",
    });
  }
}

async function main(): Promise<void> {
  const [user] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User not found: ${userId}`);
  if (user.status !== "active") throw new Error(`User is not active: ${user.status}`);

  const providerId = await ensureProvider();
  let created = 0;
  let skipped = 0;

  console.log("Verifying non-native deployments against LI.FI…");
  for (const spec of SEED) {
    for (const dep of spec.deployments) await assertLifiToken(spec, dep);
  }
  console.log("LI.FI verification ok");

  for (const spec of SEED) {
    const issuerId = spec.issuerName ? await ensureIssuer(spec.issuerName, spec.issuerWebsite) : null;
    const instrumentId = await findOrCreateInstrument(spec, userId, issuerId);
    await ensurePrice(instrumentId, spec.cmcId);
    if (spec.rwa && !spec.deployments.every((d) => d.permissioned)) {
      await ensureRwaRule(instrumentId, spec.issuerWebsite ?? "https://ondo.finance");
    }

    for (const dep of spec.deployments) {
      const live = await findLiveDeployment(dep, spec.symbol);
      if (live) {
        skipped += 1;
        await ensureRoute(instrumentId, live, providerId, userId, spec.routeMethod ?? "swap");
        console.log(`skip  ${spec.symbol} @ ${dep.chain}${dep.address ? ` ${dep.address}` : " (native)"}${dep.permissioned ? " [permissioned]" : ""}`);
        continue;
      }
      const [deployment] = await db.insert(instrumentDeployments).values({
        instrumentId,
        chain: dep.chain,
        tokenStandard: dep.tokenStandard,
        address: dep.address ?? null,
        decimals: dep.decimals,
        verification: "manual",
        sourceUrl: dep.sourceUrl ?? null,
        permissioned: dep.permissioned ?? false,
        status: "ACTIVE",
        approvedByUserId: userId,
      }).returning({ id: instrumentDeployments.id });
      await db.insert(assetEvents).values({
        instrumentId,
        entityType: "deployment",
        entityId: deployment!.id,
        kind: "activated",
        toStatus: "ACTIVE",
        actorUserId: userId,
        requestId,
      });
      await ensureRoute(instrumentId, deployment!.id, providerId, userId, spec.routeMethod ?? "swap");
      created += 1;
      console.log(`add   ${spec.symbol} @ ${dep.chain}${dep.address ? ` ${dep.address}` : " (native)"} → ${instrumentId}`);
    }
  }

  console.log(`done created=${created} skipped=${skipped} requestId=${requestId}`);
}

try {
  await main();
} finally {
  await db.$client.end({ timeout: 5 });
}
