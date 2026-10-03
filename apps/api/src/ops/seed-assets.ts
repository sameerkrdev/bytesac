/**
 * Local/dev seed: inserts well-known natives, tokens, Ondo RWAs/equities and xStocks as ACTIVE instruments.
 * Usage: pnpm --filter api ops:seed-assets -- --user <user-uuid>
 * Idempotent on live deployments (chain + address, or native chain per instrument symbol).
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

const evm = (address: string) => address.toLowerCase();

/** Ondo Global Markets tokenized equities (Ethereum). Placeholders for CMC until ops maps real ids. */
const ondoEquity = (name: string, symbol: string, address: string): InstrumentSpec => ({
  name: `${name} (Ondo Tokenized)`,
  symbol,
  assetType: "TOKENIZED_EQUITY",
  sector: "rwa_equity",
  description: `Ondo Global Markets ${symbol} — local/dev seed`,
  cmcId: `seed-${symbol.toLowerCase()}`,
  issuerName: "Ondo Global Markets",
  issuerWebsite: "https://ondo.finance",
  rwa: true,
  routeMethod: "secondary_market",
  deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: evm(address), decimals: 18, sourceUrl: "https://ondo.finance/global-markets" }],
});

/** Backed xStocks tokenized equities (Solana Token-2022). */
const xStock = (name: string, symbol: string, mint: string): InstrumentSpec => ({
  name: `${name} xStock`,
  symbol,
  assetType: "TOKENIZED_EQUITY",
  sector: "rwa_equity",
  description: `Backed xStocks ${symbol} — local/dev seed`,
  cmcId: `seed-${symbol.toLowerCase()}`,
  issuerName: "Backed (xStocks)",
  issuerWebsite: "https://xstocks.fi",
  rwa: true,
  routeMethod: "secondary_market",
  deployments: [{ chain: "solana", tokenStandard: "spl_token_2022", address: mint, decimals: 8, sourceUrl: "https://xstocks.fi" }],
});

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
    description: "Tether USDT",
    cmcId: "825",
    deployments: [
      { chain: "ethereum", tokenStandard: "erc20", address: evm("0xdAC17F958D2ee523a2206206994597C13D831ec7"), decimals: 6 },
      { chain: "bnb", tokenStandard: "erc20", address: evm("0x55d398326f99059fF775485246999027B3197955"), decimals: 18 },
      { chain: "arbitrum", tokenStandard: "erc20", address: evm("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"), decimals: 6 },
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
      { chain: "base", tokenStandard: "erc20", address: evm("0x88Fb150BDc53A65fe94Dea0c9BA0a86Cf63Ced5e"), decimals: 18 },
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
    description: "Ondo USDY (permissionless secondary market)",
    cmcId: "27760",
    issuerName: "Ondo Finance",
    issuerWebsite: "https://ondo.finance",
    rwa: true,
    routeMethod: "secondary_market",
    // Official docs.ondo.finance/addresses (Ethereum)
    deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: evm("0x96F6eF951840721AdBF46Ac996b59E0235CB985C"), decimals: 18 }],
  },
  {
    name: "Ondo Short-Term US Government Treasuries",
    symbol: "OUSG",
    assetType: "TOKENIZED_FUND",
    sector: "rwa_treasury",
    description: "Ondo OUSG (permissionless secondary market)",
    cmcId: "32843",
    issuerName: "Ondo Finance",
    issuerWebsite: "https://ondo.finance",
    rwa: true,
    routeMethod: "secondary_market",
    // Official docs.ondo.finance/addresses (Ethereum)
    deployments: [{ chain: "ethereum", tokenStandard: "erc20", address: evm("0x1B19C19393e2d034D8Ff31ff34c81252FcBbee92"), decimals: 18 }],
  },

  // Top Ondo Global Markets equities (Ethereum)
  ondoEquity("NVIDIA", "NVDAON", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"),
  ondoEquity("Tesla", "TSLAON", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"),
  ondoEquity("Apple", "AAPLON", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"),
  ondoEquity("Microsoft", "MSFTON", "0xB812837b81a3a6b81d7CD74CfB19A7f2784555E5"),
  ondoEquity("Alphabet", "GOOGLON", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"),
  ondoEquity("Meta Platforms", "METAON", "0x59644165402b611b350645555B50Afb581C71EB2"),
  ondoEquity("Amazon", "AMZNON", "0xbb8774FB97436d23d74C1b882E8E9A69322cFD31"),
  ondoEquity("SPDR S&P 500 ETF", "SPYON", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"),
  ondoEquity("Invesco QQQ Trust", "QQQON", "0x0e397938C1Aa0680954093495B70A9F5e2249aBa"),
  ondoEquity("Broadcom", "AVGOON", "0x0d54D4279B9E8c54cD8547c2C75A8Ee81A0BcaE8"),
  ondoEquity("Advanced Micro Devices", "AMDON", "0x0C1f3412A44Ff99E40bF14e06e5Ea321aE7B3938"),
  ondoEquity("Palantir", "PLTRON", "0x0c666485b02F7A87d21AdD7AEb9F5e64975AA490"),
  ondoEquity("Robinhood", "HOODON", "0x998f02A9E343EF6E3E6f28700d5A20F839fD74E6"),
  ondoEquity("Circle", "CRCLON", "0x3632DEa96A953C11dac2f00b4A05a32CD1063fAE"),
  ondoEquity("Strategy (MicroStrategy)", "MSTRON", "0xCabD955322dfbf94C084929ac5E9Eca3fEB5556F"),

  // Top Backed xStocks equities (Solana)
  xStock("NVIDIA", "NVDAX", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
  xStock("Tesla", "TSLAX", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"),
  xStock("Apple", "AAPLX", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"),
  xStock("Microsoft", "MSFTX", "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX"),
  xStock("Alphabet", "GOOGLX", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN"),
  xStock("Meta Platforms", "METAX", "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu"),
  xStock("Amazon", "AMZNX", "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg"),
  xStock("SPDR S&P 500 ETF", "SPYX", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
  xStock("Invesco QQQ Trust", "QQQX", "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ"),
  xStock("Broadcom", "AVGOX", "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo"),
  xStock("Palantir", "PLTRX", "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4"),
  xStock("Netflix", "NFLXX", "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL"),
  xStock("Eli Lilly", "LLYX", "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH"),
  xStock("Berkshire Hathaway B", "BRKBX", "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x"),
  xStock("Coinbase", "COINX", "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu"),
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
  const [existing] = await db.select({ id: priceReferences.id }).from(priceReferences)
    .where(and(eq(priceReferences.instrumentId, instrumentId), eq(priceReferences.kind, "market"), eq(priceReferences.status, "ACTIVE")));
  if (existing) return;
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

  for (const spec of SEED) {
    const issuerId = spec.issuerName ? await ensureIssuer(spec.issuerName, spec.issuerWebsite) : null;
    const instrumentId = await findOrCreateInstrument(spec, userId, issuerId);
    await ensurePrice(instrumentId, spec.cmcId);
    if (spec.rwa) await ensureRwaRule(instrumentId, spec.issuerWebsite ?? "https://ondo.finance");

    for (const dep of spec.deployments) {
      const live = await findLiveDeployment(dep, spec.symbol);
      if (live) {
        skipped += 1;
        await ensureRoute(instrumentId, live, providerId, userId, spec.routeMethod ?? "swap");
        console.log(`skip  ${spec.symbol} @ ${dep.chain}${dep.address ? ` ${dep.address}` : " (native)"}`);
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
