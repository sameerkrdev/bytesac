/**
 * Fictional, schema-valid catalogue for the mock API (visual QA and local design work only — never shipped).
 * Organizations, managers and baskets are invented; numbers are deterministic so screenshots are stable.
 */
import {
  PERFORMANCE_LABEL,
  type BasketCategory, type BasketDiff, type DiscoverySearchItem, type InstrumentSector, type PublicBasketDetail, type PublicManager, type PublicOrganization,
} from "@repo/validator";

const ISO = (d: string) => `${d}T00:00:00.000Z`;

export type Asset = { id: string; symbol: string; name: string; type: PublicBasketDetail["allocation"][number]["assetType"]; chains: string[]; sector: InstrumentSector; price: string };

const uuid = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-${n.toString(16).padStart(12, "0")}`;

export const ASSETS: Record<string, Asset> = {
  BTC: { id: uuid(1), symbol: "BTC", name: "Bitcoin", type: "CRYPTO", chains: ["bitcoin"], sector: "store_of_value", price: "97412.55" },
  WBTC: { id: uuid(2), symbol: "cbBTC", name: "Coinbase Wrapped BTC", type: "CRYPTO", chains: ["base", "ethereum"], sector: "store_of_value", price: "97380.10" },
  ETH: { id: uuid(3), symbol: "ETH", name: "Ether", type: "CRYPTO", chains: ["ethereum", "base", "arbitrum"], sector: "smart_contract_platform", price: "3521.08" },
  SOL: { id: uuid(4), symbol: "SOL", name: "Solana", type: "CRYPTO", chains: ["solana"], sector: "smart_contract_platform", price: "212.44" },
  USDC: { id: uuid(5), symbol: "USDC", name: "USD Coin", type: "STABLECOIN", chains: ["solana", "ethereum", "base", "arbitrum"], sector: "stablecoin", price: "1.00" },
  TBILL: { id: uuid(6), symbol: "TBILL", name: "Tokenized US Treasury Bill Fund", type: "TOKENIZED_TREASURY", chains: ["ethereum", "solana"], sector: "rwa_treasury", price: "1.0412" },
  GOLD: { id: uuid(7), symbol: "XAUT", name: "Tokenized Gold", type: "TOKENIZED_COMMODITY", chains: ["ethereum"], sector: "rwa_commodity", price: "2688.30" },
  ARB: { id: uuid(8), symbol: "ARB", name: "Arbitrum", type: "CRYPTO", chains: ["arbitrum"], sector: "layer2", price: "0.82" },
  OP: { id: uuid(9), symbol: "OP", name: "Optimism", type: "CRYPTO", chains: ["base", "ethereum"], sector: "layer2", price: "1.94" },
  LINK: { id: uuid(10), symbol: "LINK", name: "Chainlink", type: "CRYPTO", chains: ["ethereum", "arbitrum"], sector: "oracle_infra", price: "18.21" },
  JUP: { id: uuid(11), symbol: "JUP", name: "Jupiter", type: "CRYPTO", chains: ["solana"], sector: "defi", price: "1.12" },
  PYTH: { id: uuid(12), symbol: "PYTH", name: "Pyth Network", type: "CRYPTO", chains: ["solana"], sector: "oracle_infra", price: "0.41" },
  BNB: { id: uuid(13), symbol: "BNB", name: "BNB", type: "CRYPTO", chains: ["bnb"], sector: "smart_contract_platform", price: "689.40" },
  CREDIT: { id: uuid(14), symbol: "PCRED", name: "Tokenized Private Credit Fund", type: "TOKENIZED_PRIVATE_CREDIT", chains: ["ethereum"], sector: "rwa_credit", price: "1.0087" },
};

export const ORGS = {
  meridian: { id: uuid(101), displayName: "Meridian Research Partners", description: "An independent digital-asset research firm building rules-based index strategies with quarterly reviews.", website: "https://example.com/meridian" },
  northlight: { id: uuid(102), displayName: "Northlight Digital Assets", description: "A multi-asset team combining on-chain markets with tokenized real-world assets.", website: "https://example.com/northlight" },
  halcyon: { id: uuid(103), displayName: "Halcyon Capital", description: "Thematic strategies focused on high-throughput networks and their ecosystems.", website: "https://example.com/halcyon" },
} as const;

type OrgKey = keyof typeof ORGS;

type BasketSeed = {
  slug: string; name: string; org: OrgKey; category: BasketCategory; short: string; long: string; objective: string; thesis: string; methodology: string; investor: string; horizon: string;
  risks: string; limitations: string; weights: [keyof typeof ASSETS, number][]; minimum: string; increment: string; entryBps: number; mgmtBps: number; rebalanceBps: number;
  review: "none" | "monthly" | "quarterly"; drift: number; tags: [string, string][]; version: number; days: number; seed: number; drift1y: number; managers: { displayName: string; handle: string; role: "lead" | "co_manager" }[];
  previous?: [keyof typeof ASSETS, number][];
};

const SEEDS: BasketSeed[] = [
  {
    slug: "core-crypto-index", name: "Core Crypto Index", org: "meridian", category: "index",
    short: "The largest networks by long-run adoption, capped so no single asset dominates.",
    long: "A rules-based index of the most established crypto networks. Weights follow a capped market-value methodology and are reviewed every quarter.",
    objective: "Broad, long-term exposure to the most established public blockchains with a disciplined cap on concentration.",
    thesis: "Value in crypto has consolidated around a small number of networks with durable usage, liquidity and developer activity. Holding them together, with a cap, captures that growth while limiting single-network risk.",
    methodology: "Constituents are ranked by 180-day average market value and liquidity. Weights are proportional to market value, capped at 35% per asset, and the excess is redistributed pro rata.",
    investor: "Investors who want a single, diversified core holding in crypto and are comfortable with high volatility.", horizon: "3 years or more",
    risks: "Crypto assets are highly volatile and can fall sharply. The basket can lose most of its value. Network outages, protocol bugs and regulatory change can affect constituents.",
    limitations: "Market-value weighting follows past performance. Quarterly reviews mean weights can drift between reviews.",
    weights: [["BTC", 3500], ["ETH", 3000], ["SOL", 2000], ["LINK", 800], ["BNB", 700]], previous: [["BTC", 3000], ["ETH", 3500], ["SOL", 2000], ["LINK", 800], ["BNB", 700]],
    minimum: "100", increment: "10", entryBps: 50, mgmtBps: 75, rebalanceBps: 25, review: "quarterly", drift: 500,
    tags: [["large-cap", "Large cap"], ["rules-based", "Rules-based"]], version: 3, days: 420, seed: 7, drift1y: 0.0009,
    managers: [{ displayName: "Elena Marsh", handle: "elena-marsh", role: "lead" }, { displayName: "David Okafor", handle: "david-okafor", role: "co_manager" }],
  },
  {
    slug: "balanced-digital-real-world", name: "Balanced Digital & Real-World", org: "northlight", category: "multi_asset",
    short: "Crypto growth balanced with tokenized treasuries and gold.",
    long: "Blends the largest crypto networks with tokenized US treasuries and tokenized gold to soften drawdowns while keeping long-term upside.",
    objective: "Growth with lower volatility than a crypto-only basket.",
    thesis: "Tokenized treasuries and gold behave differently from crypto in most market regimes. Holding them alongside crypto can reduce drawdowns without leaving the on-chain world.",
    methodology: "Strategic weights reviewed monthly. No asset above 30%. Real-world assets are capped at 35% combined.",
    investor: "Investors who want crypto exposure but prefer a smoother path.", horizon: "2 years or more",
    risks: "Tokenized assets depend on their issuers and may carry transfer restrictions. Crypto assets remain highly volatile.",
    limitations: "Tokenized assets are bought on secondary markets; liquidity can be thinner than for the underlying asset.",
    weights: [["BTC", 3000], ["ETH", 2500], ["SOL", 1000], ["TBILL", 2500], ["GOLD", 1000]], previous: [["BTC", 2500], ["ETH", 2500], ["SOL", 1500], ["TBILL", 2500], ["GOLD", 1000]],
    minimum: "250", increment: "25", entryBps: 40, mgmtBps: 60, rebalanceBps: 20, review: "monthly", drift: 400,
    tags: [["rwa", "Real-world assets"], ["lower-volatility", "Lower volatility"]], version: 2, days: 300, seed: 13, drift1y: 0.0005,
    managers: [{ displayName: "Priya Raman", handle: "priya-raman", role: "lead" }],
  },
  {
    slug: "on-chain-treasury-reserve", name: "On-chain Treasury Reserve", org: "northlight", category: "rwa",
    short: "Tokenized treasury and private-credit funds with a USDC buffer.",
    long: "A conservative reserve strategy holding tokenized short-duration treasuries, a small private-credit sleeve and USDC.",
    objective: "Preserve value and earn real-world yield on chain.",
    thesis: "Short-duration government debt is now available as on-chain tokens. A reserve built from it can sit in the investor's own wallet.",
    methodology: "Fixed target weights; monthly review; USDC buffer of at least 10%.",
    investor: "Investors seeking a lower-risk, yield-oriented holding.", horizon: "6 months or more",
    risks: "Issuer, custody and legal-structure risks of each tokenized fund. Eligibility rules may apply by region and investor status.",
    limitations: "Bytesac buys these tokens on secondary markets only; it does not subscribe to or redeem from issuers.",
    weights: [["TBILL", 7000], ["CREDIT", 1500], ["USDC", 1500]],
    minimum: "500", increment: "50", entryBps: 20, mgmtBps: 30, rebalanceBps: 10, review: "monthly", drift: 300,
    tags: [["yield", "Yield"], ["rwa", "Real-world assets"]], version: 1, days: 140, seed: 3, drift1y: 0.0002,
    managers: [{ displayName: "Priya Raman", handle: "priya-raman", role: "lead" }],
  },
  {
    slug: "solana-ecosystem", name: "Solana Ecosystem", org: "halcyon", category: "thematic",
    short: "The core of the Solana network: SOL and its leading infrastructure tokens.",
    long: "Concentrated exposure to Solana and the applications that drive its activity: trading, data and liquidity.",
    objective: "Capture growth in the Solana ecosystem.",
    thesis: "High-throughput, low-fee networks attract consumer and trading activity. The value of that activity accrues to the base asset and to its core infrastructure.",
    methodology: "SOL anchors the basket at 50%; the remainder is split across infrastructure tokens by liquidity. Reviewed monthly.",
    investor: "Experienced investors with a high tolerance for risk.", horizon: "2 years or more",
    risks: "Concentrated in one network. Smaller tokens can lose most of their value quickly.",
    limitations: "Thematic baskets can underperform broad indexes for long periods.",
    weights: [["SOL", 5000], ["JUP", 2000], ["PYTH", 1500], ["USDC", 1500]],
    minimum: "50", increment: "10", entryBps: 60, mgmtBps: 100, rebalanceBps: 30, review: "monthly", drift: 600,
    tags: [["solana", "Solana"], ["thematic", "Thematic"]], version: 2, days: 210, seed: 21, drift1y: 0.0012,
    managers: [{ displayName: "Marcus Lindqvist", handle: "marcus-lindqvist", role: "lead" }],
  },
  {
    slug: "layer-2-growth", name: "Layer 2 Growth", org: "halcyon", category: "sector",
    short: "Networks scaling Ethereum, weighted by usage.",
    long: "Exposure to the leading Ethereum scaling networks alongside ETH itself.",
    objective: "Participate in the growth of Ethereum's scaling layer.",
    thesis: "Most new Ethereum activity happens on scaling networks. Their tokens and ETH together capture that shift.",
    methodology: "ETH 40%; scaling networks share the rest by 90-day activity. Quarterly review.",
    investor: "Investors comfortable with sector concentration.", horizon: "2 years or more",
    risks: "Sector concentration; governance-token value capture is uncertain.",
    limitations: "Activity metrics can be gamed or change definition.",
    weights: [["ETH", 4000], ["ARB", 3000], ["OP", 3000]],
    minimum: "100", increment: "10", entryBps: 50, mgmtBps: 80, rebalanceBps: 25, review: "quarterly", drift: 500,
    tags: [["ethereum", "Ethereum"]], version: 1, days: 20, seed: 5, drift1y: 0.0004,
    managers: [{ displayName: "Marcus Lindqvist", handle: "marcus-lindqvist", role: "lead" }],
  },
];

/** Deterministic pseudo-random walk for the simulated model series. */
function series(days: number, seed: number, driftPerDay: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let net = 1, gross = 1;
  const out: { day: string; net: string; gross: string }[] = [];
  const start = Date.UTC(2026, 9, 3) - days * 86_400_000;
  for (let i = 0; i <= days; i++) {
    const r = (rnd() - 0.5) * 0.045 + driftPerDay;
    gross *= 1 + r;
    net *= 1 + r - 0.00003;
    if (i % Math.max(1, Math.ceil(days / 380)) === 0 || i === days) out.push({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), net: net.toFixed(6), gross: gross.toFixed(6) });
  }
  return out;
}

const frac = (x: number) => x.toFixed(6);
const ret = (pts: { net: string }[], back: number) => (pts.length > back ? frac(Number(pts.at(-1)!.net) / Number(pts.at(-1 - back)!.net) - 1) : null);

function diffOf(prev: [string, number][] | undefined, next: [string, number][]): BasketDiff {
  const p = new Map((prev ?? []).map(([k, w]) => [ASSETS[k]!.id, w]));
  const n = new Map(next.map(([k, w]) => [ASSETS[k]!.id, w]));
  return {
    added: [...n].filter(([id]) => !p.has(id)).map(([instrumentId, weightBps]) => ({ instrumentId, weightBps })),
    removed: [...p].filter(([id]) => !n.has(id)).map(([instrumentId, weightBps]) => ({ instrumentId, weightBps })),
    changed: [...n].filter(([id, w]) => p.has(id) && p.get(id) !== w).map(([instrumentId, toBps]) => ({ instrumentId, fromBps: p.get(instrumentId)!, toBps })),
    bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false,
  };
}

const RWA = new Set(["TOKENIZED_TREASURY", "TOKENIZED_COMMODITY", "TOKENIZED_PRIVATE_CREDIT"]);

export function basketDetail(seed: BasketSeed, signedIn: boolean): PublicBasketDetail {
  const pts = series(seed.days, seed.seed, seed.drift1y);
  const perStep = Math.max(1, Math.ceil(seed.days / 380));
  const available = seed.days >= 30;
  const sectors = new Map<InstrumentSector, number>();
  for (const [k, w] of seed.weights) sectors.set(ASSETS[k]!.sector, (sectors.get(ASSETS[k]!.sector) ?? 0) + w);
  const published = ISO(new Date(Date.UTC(2026, 9, 3) - 45 * 86_400_000).toISOString().slice(0, 10));
  const rwa = seed.weights.some(([k]) => RWA.has(ASSETS[k]!.type));
  return {
    slug: seed.slug, status: "ACTIVE", hasAssetWarning: false,
    eligibility: { requirements: rwa, ...(signedIn && rwa ? { assets: seed.weights.filter(([k]) => RWA.has(ASSETS[k]!.type)).map(([k]) => ({ instrumentId: ASSETS[k]!.id, outcome: "DECLARATION_REQUIRED", reason: "declaration_required" })) } : {}) },
    organization: { id: ORGS[seed.org].id, displayName: ORGS[seed.org].displayName },
    version: {
      versionNumber: seed.version, publishedAt: published, name: seed.name, shortDescription: seed.short, longDescription: seed.long, category: seed.category, tags: seed.tags.map((t) => t[0]),
      objective: seed.objective, thesis: seed.thesis, methodology: seed.methodology, intendedInvestor: seed.investor, horizon: seed.horizon,
      keyAssumptions: "Liquidity in each constituent remains sufficient to trade at the basket minimum.", knownLimitations: seed.limitations, strategyRisks: seed.risks,
      liquidityNotes: "Each constituent is traded through supported routes; some trades may need several transactions across chains.", conflictsOfInterest: "None declared.",
      constraints: { maxWeightPerAssetBps: Math.max(...seed.weights.map((w) => w[1])) }, rebalance: { reviewFrequency: seed.review, driftThresholdBps: seed.drift },
      fees: { entry: { type: "percent", bps: seed.entryBps, maxUsdc: "50" }, management: { type: "percent", bps: seed.mgmtBps }, rebalance: { type: "percent", bps: seed.rebalanceBps }, subscription: null },
      minimumInvestmentUsdc: seed.minimum, minimumIncrementUsdc: seed.increment,
    },
    allocation: seed.weights.map(([k, w]) => {
      const a = ASSETS[k]!;
      return { instrumentId: a.id, name: a.name, symbol: a.symbol, assetType: a.type, chains: a.chains, targetWeightBps: w, minWeightBps: Math.max(0, w - seed.drift), maxWeightBps: Math.min(10_000, w + seed.drift),
        prices: [{ instrumentId: a.id, kind: "market" as const, status: "ok" as const, value: a.price, currency: "USD", source: "coinmarketcap", observedAt: "2026-10-03T23:58:00.000Z", stale: false }] };
    }),
    platformFee: [{ operationKind: "invest", bps: 0, minUsdc: null, maxUsdc: null }, { operationKind: "rebalance_apply", bps: 0, minUsdc: null, maxUsdc: null }],
    disclosures: [
      { title: "Risk of loss", body: "Digital assets are volatile. You can lose some or all of the amount you invest. [Placeholder disclosure — pending legal review.]" },
      ...(rwa ? [{ title: "Tokenized assets", body: "Tokenized real-world assets depend on their issuers and may be restricted by region or investor status. Bytesac buys them on secondary markets only. [Placeholder disclosure — pending legal review.]" }] : []),
    ],
    versionHistory: Array.from({ length: seed.version }, (_, i) => seed.version - i).map((v) => ({
      versionNumber: v, publishedAt: ISO(new Date(Date.UTC(2026, 9, 3) - (seed.version - v + 1) * 45 * 86_400_000).toISOString().slice(0, 10)),
      rationale: v === seed.version && seed.previous ? "Rebalanced toward the target method after the quarterly review: Bitcoin's capped market value rose relative to Ether." : v === 1 ? "Initial publication." : "Routine review; no structural change.",
      diff: v === seed.version ? diffOf(seed.previous, seed.weights) : v === 1 ? diffOf(undefined, seed.previous ?? seed.weights) : diffOf(seed.previous ?? seed.weights, seed.previous ?? seed.weights),
    })),
    managers: seed.managers.map((m) => ({ ...m, from: ISO("2026-01-15"), to: null })),
    performance: { available, dataDays: seed.days, series: available ? pts : [] },
    metrics: {
      available, dataDays: seed.days,
      net: { sinceLaunch: available ? ret(pts, pts.length - 1) : null, d30: available ? ret(pts, Math.ceil(30 / perStep)) : null, d90: seed.days >= 90 ? ret(pts, Math.ceil(90 / perStep)) : null, y1: seed.days >= 365 ? ret(pts, Math.ceil(365 / perStep)) : null },
      gross: { sinceLaunch: available ? frac(Number(pts.at(-1)!.gross) - 1) : null, d30: null, d90: null, y1: null },
      volatility: available ? "0.482000" : null, maxDrawdown: available ? "-0.231000" : null,
    },
    sectors: [...sectors].map(([sector, bps]) => ({ sector, bps })),
    tags: seed.tags.map(([key, label]) => ({ key, label })),
    label: PERFORMANCE_LABEL,
  };
}

export const BASKETS = SEEDS;

export function searchItem(seed: BasketSeed): DiscoverySearchItem {
  const d = basketDetail(seed, false);
  return {
    slug: seed.slug, name: seed.name, shortDescription: seed.short, organizationName: ORGS[seed.org].displayName, category: seed.category, status: "ACTIVE",
    topAssets: seed.weights.map(([k, bps]) => ({ symbol: ASSETS[k]!.symbol, bps })), minimumInvestmentUsdc: seed.minimum, managementFeeBps: seed.mgmtBps,
    netReturn1y: d.metrics.net.y1, available: true, hasEligibilityRequirements: d.eligibility.requirements,
  };
}

export function publicManager(handle: string): PublicManager | null {
  const all = SEEDS.flatMap((s) => s.managers.map((m) => ({ ...m, basket: s })));
  const mine = all.filter((m) => m.handle === handle);
  if (mine.length === 0) return null;
  const orgKeys = [...new Set(mine.map((m) => m.basket.org))];
  return {
    handle, displayName: mine[0]!.displayName, headline: "Portfolio manager", bio: "Builds rules-based digital-asset strategies with a focus on risk control and clear communication with investors.",
    experienceYears: 11, background: "Previously a quantitative analyst covering multi-asset portfolios.", qualifications: ["CFA charterholder"], links: [],
    selfReported: ["experienceYears", "qualifications"], verified: true,
    baskets: mine.map((m) => ({ slug: m.basket.slug, name: m.basket.name, status: "ACTIVE" as const, role: m.role, from: ISO("2026-01-15"), to: null })),
    organizations: orgKeys.map((k) => ({ organizationId: ORGS[k].id, organizationName: ORGS[k].displayName, role: "MANAGER", title: "Portfolio Manager", current: true, from: ISO("2025-11-01"), to: null })),
  };
}

export function publicOrganization(id: string): PublicOrganization | null {
  const key = (Object.keys(ORGS) as OrgKey[]).find((k) => ORGS[k].id === id);
  if (!key) return null;
  const o = ORGS[key];
  const team = [...new Map(SEEDS.filter((s) => s.org === key).flatMap((s) => s.managers).map((m) => [m.handle, m])).values()];
  return {
    id: o.id, type: "firm", jurisdiction: "GB", verifiedAt: ISO("2025-12-01"),
    profile: {
      displayName: o.displayName, about: o.description,
      experience: "The team has managed multi-asset and digital-asset portfolios since 2017, with a focus on transparent, rules-based methods.",
      investmentPhilosophy: "Diversify across durable networks, cap concentration, and explain every change to investors before it happens.",
      website: o.website, registrations: "[Fictional organization for design previews.]",
    },
    team: { current: team.map((m) => ({ displayName: m.displayName, title: "Portfolio Manager", role: "MANAGER" as const })), former: [] },
    baskets: SEEDS.filter((s) => s.org === key).map((s) => ({ slug: s.slug, name: s.name, status: "ACTIVE" })),
  };
}
