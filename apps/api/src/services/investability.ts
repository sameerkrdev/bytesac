import createHttpError from "http-errors";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  assetProviders, basketVersionAssets, basketVersions, baskets, contacts, executionRoutes, instrumentDeployments, instruments, investmentWallets, operations, walletAddresses,
  type DbOrTx,
} from "@repo/db";
import { ASSET_CHAINS, RWA_PROBLEMS, RWA_ROUTE_METHODS, USDC_SOLANA_MINT, rwaProblem, type AssetChain, type AssetType, type ChainFamily, type Investability } from "@repo/validator";
import { selectRouteProvider } from "@/providers/routes";
import type { RouteProvider } from "@/providers/routes/types";
import { evaluateFor, isRwa, type Evaluated } from "./eligibility";
import { getPrices } from "@/modules/assets/pricing.service";

export interface Constituent {
  instrumentId: string;
  assetType: AssetType;
  symbol: string;
  weightBps: number;
  deployment: { id: string; chain: AssetChain; tokenStandard: string; address: string | null; decimals: number };
  provider: RouteProvider;
}

/** The public result plus what the planner needs to act on it (never sent to clients as is). */
export type InvestabilityResult = Investability & { basketId: string; versionId: string | null; constituents: Constituent[]; rwaDecisions: Map<string, Evaluated> };

/** Spec §4: basket rules, then (with a viewer) eligibility. A route-provider outage is reported as a reason, never thrown. */
export async function getInvestability(db: DbOrTx, basket: { slug: string } | { id: string }, viewer: { userId: string; ipCountry: string | null } | null): Promise<InvestabilityResult> {
  const [b] = await db.select({ id: baskets.id, status: baskets.status, versionId: baskets.currentVersionId })
    .from(baskets).where("slug" in basket ? eq(baskets.slug, basket.slug) : eq(baskets.id, basket.id));
  if (!b) throw createHttpError("Basket not found", { code: "NOT_FOUND" });
  const reasons: Investability["reasons"] = [];
  const constituents: Constituent[] = [];
  const families = new Set<ChainFamily>();
  let minimumUsdc: string | null = null;

  if (b.status !== "ACTIVE" || !b.versionId) reasons.push({ code: "BASKET_NOT_ACTIVE", message: "This basket is not open for investment." });
  else {
    const [v] = await db.select({ assetsRevision: basketVersions.assetsRevision, minimum: basketVersions.minimumInvestmentUsdc }).from(basketVersions).where(eq(basketVersions.id, b.versionId));
    minimumUsdc = v!.minimum;
    const assets = await db.select({ instrumentId: instruments.id, symbol: instruments.symbol, assetType: instruments.assetType, status: instruments.status, bps: basketVersionAssets.targetWeightBps })
      .from(basketVersionAssets).innerJoin(instruments, eq(instruments.id, basketVersionAssets.instrumentId))
      .where(and(eq(basketVersionAssets.versionId, b.versionId), eq(basketVersionAssets.revision, v!.assetsRevision))).orderBy(sql`${basketVersionAssets.targetWeightBps} desc`, asc(instruments.id));
    const candidates = await db.select({
      instrumentId: instrumentDeployments.instrumentId, id: instrumentDeployments.id, chain: instrumentDeployments.chain, tokenStandard: instrumentDeployments.tokenStandard,
      address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, providerName: assetProviders.name, permissioned: instrumentDeployments.permissioned, method: executionRoutes.method,
    }).from(instrumentDeployments)
      .innerJoin(executionRoutes, and(eq(executionRoutes.deploymentId, instrumentDeployments.id), eq(executionRoutes.status, "ACTIVE")))
      .innerJoin(assetProviders, eq(assetProviders.id, executionRoutes.providerId))
      .where(and(inArray(instrumentDeployments.instrumentId, assets.map((a) => a.instrumentId)), eq(instrumentDeployments.status, "ACTIVE")))
      .orderBy(asc(instrumentDeployments.createdAt), asc(instrumentDeployments.id));

    const priced = new Set((await getPrices(assets.filter((a) => isRwa(a.assetType)).map((a) => a.instrumentId))).filter((p) => p.kind === "market" && p.status === "ok" && !p.stale && p.value).map((p) => p.instrumentId));
    const resolved = await Promise.all(assets.map(async (a): Promise<Constituent | undefined> => {
      const no = (code: string, message: string): undefined => { reasons.push({ instrumentId: a.instrumentId, code, message: `${a.symbol}: ${message}` }); };
      if (a.status !== "ACTIVE") return no("INSTRUMENT_NOT_ACTIVE", "this asset is not active.");
      let options = candidates.filter((c) => c.instrumentId === a.instrumentId);
      if (options.length === 0) return no("NO_ROUTE", "no active deployment with an active execution route.");
      if (isRwa(a.assetType)) {
        // Spec 11 section 4: permissionless token, synchronous secondary-market route through the provider, a fresh CoinMarketCap market price.
        const problem = rwaProblem(options, priced.has(a.instrumentId));
        if (problem) return no(problem, RWA_PROBLEMS[problem]);
        options = options.filter((c) => !c.permissioned && RWA_ROUTE_METHODS.includes(c.method));
      }
      let why: [string, string] = ["NO_ROUTE", "no enabled route provider."];
      for (const d of options) {
        const provider = selectRouteProvider([d.providerName]);
        if (!provider) continue;
        if (d.chain === "bitcoin" && d.tokenStandard !== "native") { why = ["BTC_NOT_NATIVE", "Bitcoin is supported as native BTC only."]; continue; }
        try {
          if (!(await provider.connections({ fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: d.chain, toToken: d.address }))) { why = ["NO_CONNECTION", "no route from USDC on Solana."]; continue; }
        } catch {
          why = ["ROUTE_UNAVAILABLE", "the route provider is unavailable."];
          continue;
        }
        families.add(ASSET_CHAINS[d.chain].family);
        return { instrumentId: a.instrumentId, assetType: a.assetType, symbol: a.symbol, weightBps: a.bps, deployment: { id: d.id, chain: d.chain, tokenStandard: d.tokenStandard, address: d.address, decimals: d.decimals }, provider };
      }
      return no(...why);
    }));
    constituents.push(...resolved.filter((c) => c !== undefined));
  }

  const investable = reasons.length === 0;
  const result: InvestabilityResult = {
    investable, reasons, minimumUsdc, basketId: b.id, versionId: b.versionId, constituents, rwaDecisions: new Map(),
    requiredFamilies: (["solana", "evm", "bitcoin"] as const).filter((f) => f === "solana" || families.has(f)),
  };
  if (viewer) {
    result.eligibility = await eligibilityOf(db, viewer.userId, result.requiredFamilies);
    // Spec 11 section 4: each RWA constituent is evaluated for acquiring; anything but ALLOWED blocks the basket for this user.
    result.rwaDecisions = await evaluateFor(db, { userId: viewer.userId, ipCountry: viewer.ipCountry, items: constituents.filter((c) => isRwa(c.assetType)).map((c) => ({ instrumentId: c.instrumentId, assetType: c.assetType, deploymentId: c.deployment.id, action: "acquire" as const })) });
    for (const [instrumentId, r] of result.rwaDecisions) {
      const symbol = constituents.find((c) => c.instrumentId === instrumentId)!.symbol;
      if (r.outcome === "DECLARATION_REQUIRED") result.eligibility.reasons.push({ instrumentId, code: "DECLARATION_REQUIRED", message: "Tell us your country and investor status to see if you can hold tokenized assets." });
      else if (r.outcome !== "ALLOWED") result.eligibility.reasons.push({ instrumentId, code: "NOT_ELIGIBLE_ASSET", outcome: r.outcome, reason: r.reason, message: `${symbol} isn't available to you (${r.reason === "IP_COUNTRY_MISMATCH" ? "your location doesn't match your declared country" : "your region or investor status"}).` });
    }
    result.eligibility.eligible = result.eligibility.reasons.length === 0;
  }
  return result;
}

async function eligibilityOf(db: DbOrTx, userId: string, required: readonly ChainFamily[]): Promise<NonNullable<Investability["eligibility"]>> {
  const reasons: NonNullable<Investability["eligibility"]>["reasons"] = [];
  const verified = new Set((await db.select({ type: contacts.type }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.status, "verified")))).map((c) => c.type));
  if (!verified.has("email")) reasons.push({ code: "EMAIL_NOT_VERIFIED", message: "Verify your email." });
  if (!verified.has("phone")) reasons.push({ code: "PHONE_NOT_VERIFIED", message: "Verify your phone." });
  const linked = new Set((await db.select({ family: walletAddresses.chainFamily }).from(investmentWallets)
    .innerJoin(walletAddresses, and(eq(walletAddresses.investmentWalletId, investmentWallets.id), eq(walletAddresses.status, "active")))
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")))).map((r) => r.family));
  for (const f of required) {
    if (!linked.has(f)) reasons.push({ code: f === "bitcoin" ? "BTC_ADDRESS_REQUIRED" : `${f.toUpperCase()}_ADDRESS_REQUIRED`, message: `Link a${f === "evm" ? "n EVM" : f === "bitcoin" ? " Bitcoin" : " Solana"} wallet.` });
  }
  const [active] = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.userId, userId), inArray(operations.status, ["PLANNED", "IN_PROGRESS"]), sql`(${operations.status} = 'IN_PROGRESS' or ${operations.expiresAt} > now())`)).limit(1);
  if (active) reasons.push({ code: "OPERATION_IN_PROGRESS", message: "Finish or cancel your current operation first." });
  return { eligible: reasons.length === 0, reasons };
}
