import createHttpError from "http-errors";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, exists, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  assetEvents, assetIssuers, assetProviders, assetTags, basketVersionAssets, baskets, db, eligibilityRules, executionRoutes, instrumentDeployments, instrumentTags, instruments, isUniqueViolation, navObservations,
  priceReferences, type DbOrTx, type Tx,
} from "@repo/db";
import {
  ASSET_CHAINS, RWA_ASSET_TYPES, createDeploymentRequestSchema,
  type AssetChain, type AssetTagView, type CreateAssetTagRequest, type ListAssetTagsResponse, type AssetProviderRequest, type AssetListQuery, type AssetProviderView, type CreateDeploymentRequest, type CreateInstrumentRequest, type CreateRouteRequest, type CreateRuleRequest,
  type IssuerRequest, type IssuerView, type NavEntryRequest, type OpsAssetDetail, type OpsAssetListResponse, type OpsAssetListQuery, type PublicAssetDetail, type PublicAssetListResponse, type PutPriceReferenceRequest,
  type TokenStandard, type UpdateAssetProviderRequest, type UpdateDeploymentRequest, type UpdateInstrumentRequest, type UpdateIssuerRequest, type UpdateRouteRequest, type UpdateRuleRequest,
} from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import { readTokenMetadata } from "../providers/evm-rpc";
import { getMintDecimals } from "../providers/solana-rpc";
import { cursorSchema, type OpsCtx } from "./applications";
import { writeAudit } from "./audit";
import { lifiVerification } from "./routing";
import { enqueue } from "../queues";
import { getPrices } from "./pricing";
import { canonicalizeAddress } from "./wallets";

export const PAGE_SIZE = 25;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = (what: string) => createHttpError(`${what} not found`, { code: "NOT_FOUND" });
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const LOCKED = "Retire this item and add a new one to change it.";
type DeploymentRow = typeof instrumentDeployments.$inferSelect;
type EventEntity = typeof assetEvents.$inferInsert.entityType;
type EventKind = typeof assetEvents.$inferInsert.kind;

/** Writes the asset event and its audit row; call inside the transaction that made the change. */
export async function recordAssetEvent(
  tx: Tx, ctx: OpsCtx,
  e: { instrumentId: string; entityType: EventEntity; entityId: string; kind: EventKind; fromStatus?: string; toStatus?: string; message?: string | null; internalNote?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(assetEvents).values({
    instrumentId: e.instrumentId, entityType: e.entityType, entityId: e.entityId, kind: e.kind, fromStatus: e.fromStatus ?? null, toStatus: e.toStatus ?? null,
    actorUserId: ctx.userId, message: e.message ?? null, internalNote: e.internalNote ?? null, requestId: ctx.meta.requestId,
  });
  await writeAudit(tx, {
    actorType: "user", actorUserId: ctx.userId, action: `asset.${e.entityType}.${e.kind}`, entityType: e.entityType, entityId: e.entityId, requestId: ctx.meta.requestId,
    metadata: { instrumentId: e.instrumentId, ...e.metadata },
  });
}

/** Locks the instrument row for the rest of the transaction. */
export async function lockInstrument(tx: Tx, id: string) {
  const [row] = await tx.select().from(instruments).where(eq(instruments.id, id)).for("update");
  if (!row) throw notFound("Asset");
  return row;
}

/** Edits and additions are refused while the admin is deciding (they decide on what was submitted) and after retirement. */
export async function lockEditable(tx: Tx, id: string) {
  const row = await lockInstrument(tx, id);
  if (row.status === "UNDER_REVIEW") throw invalid("This asset is under review.");
  if (row.status === "RETIRED") throw invalid("This asset is retired.");
  return row;
}

// ---------------------------------------------------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------------------------------------------------

/** The submit/approve check of one deployment: on-chain values must match what ops entered; manual ones need a source. */
export function deploymentProblem(d: Pick<DeploymentRow, "verification" | "decimals" | "observedDecimals" | "sourceUrl">): "deployment_verification" | "deployment_source_url" | null {
  if (d.verification === "onchain") return d.observedDecimals === d.decimals ? null : "deployment_verification";
  return d.sourceUrl ? null : "deployment_source_url";
}

/** Stable keys (`ASSET_REQUIREMENT_KEYS`, in that order) of what still blocks submit and approval. */
export async function missingRequirements(conn: DbOrTx, instrumentId: string): Promise<string[]> {
  const [inst] = await conn.select({ assetType: instruments.assetType, issuerId: instruments.issuerId }).from(instruments).where(eq(instruments.id, instrumentId));
  if (!inst) throw notFound("Asset");
  const deployments = await conn.select().from(instrumentDeployments).where(and(eq(instrumentDeployments.instrumentId, instrumentId), ne(instrumentDeployments.status, "RETIRED")));
  const problems = deployments.map(deploymentProblem);
  const [market] = await conn.select({ id: priceReferences.id }).from(priceReferences).where(and(eq(priceReferences.instrumentId, instrumentId), eq(priceReferences.kind, "market"), eq(priceReferences.status, "ACTIVE")));
  const isRwa = RWA_ASSET_TYPES.includes(inst.assetType);
  const [route] = isRwa ? await conn.select({ id: executionRoutes.id }).from(executionRoutes).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, executionRoutes.deploymentId)).where(and(eq(executionRoutes.instrumentId, instrumentId), ne(executionRoutes.status, "RETIRED"), ne(instrumentDeployments.status, "RETIRED"))).limit(1) : [];
  const [rule] = isRwa ? await conn.select({ id: eligibilityRules.id }).from(eligibilityRules).where(and(eq(eligibilityRules.instrumentId, instrumentId), eq(eligibilityRules.status, "ACTIVE"))).limit(1) : [];
  return [
    deployments.length === 0 && "deployment",
    problems.includes("deployment_verification") && "deployment_verification",
    problems.includes("deployment_source_url") && "deployment_source_url",
    !isRwa && !market && "market_price_reference",
    isRwa && !inst.issuerId && "issuer",
    isRwa && !route && "route",
    isRwa && !rule && "eligibility_rule",
  ].filter((k): k is string => k !== false);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------

/** Keyset page of instruments, newest update first. `live` = the session view: ACTIVE instruments and ACTIVE deployments only. */
export async function pageInstruments(q: OpsAssetListQuery, live: boolean) {
  const deploymentScope = (chain?: AssetChain) => and(
    eq(instrumentDeployments.instrumentId, instruments.id),
    live ? eq(instrumentDeployments.status, "ACTIVE") : ne(instrumentDeployments.status, "RETIRED"),
    chain ? eq(instrumentDeployments.chain, chain) : undefined,
  );
  const conditions: SQL[] = [];
  if (live) conditions.push(eq(instruments.status, "ACTIVE"));
  else if (q.status) conditions.push(eq(instruments.status, q.status));
  if (q.type) conditions.push(eq(instruments.assetType, q.type));
  if (live || q.chain) conditions.push(exists(db.select({ one: sql`1` }).from(instrumentDeployments).where(deploymentScope(q.chain))));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(instruments.name, like), ilike(instruments.symbol, like))!);
  }
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${instruments.updatedAt}, ${instruments.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({ instrument: instruments, cursorTs: sql<string>`${instruments.updatedAt}::text` }).from(instruments)
    .where(and(...conditions)).orderBy(desc(instruments.updatedAt), desc(instruments.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const chains = page.length === 0 ? [] : await db.selectDistinct({ instrumentId: instrumentDeployments.instrumentId, chain: instrumentDeployments.chain }).from(instrumentDeployments)
    .where(and(inArray(instrumentDeployments.instrumentId, page.map((r) => r.instrument.id)), live ? eq(instrumentDeployments.status, "ACTIVE") : ne(instrumentDeployments.status, "RETIRED")))
    .orderBy(instrumentDeployments.chain);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r.instrument, chains: chains.filter((c) => c.instrumentId === r.instrument.id).map((c) => c.chain) })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.instrument.id}`).toString("base64url") : null,
  };
}

export async function listAssetsForOps(q: OpsAssetListQuery): Promise<OpsAssetListResponse> {
  const { items, nextCursor } = await pageInstruments(q, false);
  return { items: items.map((i) => ({ id: i.id, name: i.name, symbol: i.symbol, assetType: i.assetType, status: i.status, chains: i.chains, updatedAt: i.updatedAt.toISOString() })), nextCursor };
}

export async function getAssetForOps(id: string): Promise<OpsAssetDetail> {
  const [inst] = await db.select().from(instruments).where(eq(instruments.id, id));
  if (!inst) throw notFound("Asset");
  const [deployments, routes, rules, refs, events, missing, prices, tags] = await Promise.all([
    db.select().from(instrumentDeployments).where(eq(instrumentDeployments.instrumentId, id)).orderBy(instrumentDeployments.createdAt, instrumentDeployments.id),
    db.select().from(executionRoutes).where(eq(executionRoutes.instrumentId, id)).orderBy(executionRoutes.createdAt, executionRoutes.id),
    db.select().from(eligibilityRules).where(eq(eligibilityRules.instrumentId, id)).orderBy(eligibilityRules.createdAt, eligibilityRules.id),
    db.select().from(priceReferences).where(eq(priceReferences.instrumentId, id)).orderBy(priceReferences.createdAt, priceReferences.id),
    db.select().from(assetEvents).where(eq(assetEvents.instrumentId, id)).orderBy(assetEvents.createdAt, assetEvents.id),
    missingRequirements(db, id),
    getPrices([id]),
    db.select({ id: assetTags.id, key: assetTags.key, label: assetTags.label }).from(instrumentTags).innerJoin(assetTags, eq(assetTags.id, instrumentTags.tagId))
      .where(and(eq(instrumentTags.instrumentId, id), isNull(instrumentTags.removedAt))).orderBy(assetTags.key),
  ]);
  const navs = refs.length === 0 ? [] : await db.select().from(navObservations).where(inArray(navObservations.priceReferenceId, refs.map((r) => r.id))).orderBy(desc(navObservations.asOf), desc(navObservations.createdAt));
  return {
    id: inst.id, name: inst.name, symbol: inst.symbol, assetType: inst.assetType, description: inst.description, issuerId: inst.issuerId, riskNotes: inst.riskNotes, links: inst.links,
    sector: inst.sector, tags,
    status: inst.status, createdByUserId: inst.createdByUserId, submittedByUserId: inst.submittedByUserId, decidedByUserId: inst.decidedByUserId,
    createdAt: inst.createdAt.toISOString(), updatedAt: inst.updatedAt.toISOString(),
    deployments: await Promise.all(deployments.map(async (d) => ({ ...d, lifiVerification: await lifiVerification(d.chain, d.address), observedAt: iso(d.observedAt), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() }))),
    routes: routes.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    rules: rules.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    priceReferences: refs.map((r) => ({ id: r.id, kind: r.kind, provider: r.provider, externalId: r.externalId, quoteCurrency: "USD" as const, status: r.status, createdAt: r.createdAt.toISOString() })),
    navObservations: navs.map((n) => ({ ...n, currency: "USD" as const, createdAt: n.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, entityType: e.entityType, entityId: e.entityId, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, actorUserId: e.actorUserId, message: e.message, internalNote: e.internalNote, createdAt: e.createdAt.toISOString() })),
    missing, prices,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Session read API: ACTIVE instruments with ACTIVE items, explicit public columns only
// ---------------------------------------------------------------------------------------------------------------------

export async function listPublicAssets(q: AssetListQuery): Promise<PublicAssetListResponse> {
  const { items, nextCursor } = await pageInstruments(q, true);
  return { items: items.map((i) => ({ id: i.id, name: i.name, symbol: i.symbol, assetType: i.assetType, chains: i.chains })), nextCursor };
}

/** An instrument that is not ACTIVE is a 404, and so is everything under it: a paused or deprecated instrument hides all of its items. */
export async function getPublicAsset(id: string): Promise<PublicAssetDetail> {
  const [inst] = await db.select({
    id: instruments.id, name: instruments.name, symbol: instruments.symbol, assetType: instruments.assetType, description: instruments.description, riskNotes: instruments.riskNotes, links: instruments.links,
    issuerName: assetIssuers.name, issuerWebsite: assetIssuers.website,
  }).from(instruments).leftJoin(assetIssuers, eq(assetIssuers.id, instruments.issuerId)).where(and(eq(instruments.id, id), eq(instruments.status, "ACTIVE")));
  if (!inst) throw notFound("Asset");
  const settlement = alias(instruments, "settlement");
  const [deployments, routes, prices] = await Promise.all([
    db.select({ chain: instrumentDeployments.chain, tokenStandard: instrumentDeployments.tokenStandard, address: instrumentDeployments.address, decimals: instrumentDeployments.decimals })
      .from(instrumentDeployments).where(and(eq(instrumentDeployments.instrumentId, id), eq(instrumentDeployments.status, "ACTIVE"))).orderBy(instrumentDeployments.createdAt, instrumentDeployments.id),
    // A route is shown only with its own deployment active; a settlement asset only while it is ACTIVE itself.
    db.select({
      chain: instrumentDeployments.chain, method: executionRoutes.method, providerName: assetProviders.name, settlementSymbol: settlement.symbol,
      minimumAmount: executionRoutes.minimumAmount, processingModel: executionRoutes.processingModel,
    }).from(executionRoutes)
      .innerJoin(instrumentDeployments, and(eq(instrumentDeployments.id, executionRoutes.deploymentId), eq(instrumentDeployments.status, "ACTIVE")))
      .innerJoin(assetProviders, eq(assetProviders.id, executionRoutes.providerId))
      .leftJoin(settlement, and(eq(settlement.id, executionRoutes.settlementInstrumentId), eq(settlement.status, "ACTIVE")))
      .where(and(eq(executionRoutes.instrumentId, id), eq(executionRoutes.status, "ACTIVE"))).orderBy(executionRoutes.createdAt, executionRoutes.id),
    getPrices([id]),
  ]);
  return {
    id: inst.id, name: inst.name, symbol: inst.symbol, assetType: inst.assetType, description: inst.description, riskNotes: inst.riskNotes, links: inst.links,
    issuer: inst.issuerName === null ? null : { name: inst.issuerName, website: inst.issuerWebsite },
    deployments, routes, prices,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------------------------------

async function assertIssuer(tx: Tx, issuerId: string | null | undefined): Promise<void> {
  if (!issuerId) return;
  const [issuer] = await tx.select({ id: assetIssuers.id }).from(assetIssuers).where(eq(assetIssuers.id, issuerId));
  if (!issuer) throw notFound("Issuer");
}

export async function createInstrument(ctx: OpsCtx, body: CreateInstrumentRequest): Promise<OpsAssetDetail> {
  const id = await db.transaction(async (tx) => {
    await assertIssuer(tx, body.issuerId);
    const [row] = await tx.insert(instruments).values({ ...body, createdByUserId: ctx.userId }).returning({ id: instruments.id });
    await recordAssetEvent(tx, ctx, { instrumentId: row!.id, entityType: "instrument", entityId: row!.id, kind: "created", toStatus: "DRAFT" });
    return row!.id;
  });
  return getAssetForOps(id);
}

export async function updateInstrument(ctx: OpsCtx, id: string, body: UpdateInstrumentRequest): Promise<OpsAssetDetail> {
  const { tagIds, ...fields } = body;
  await db.transaction(async (tx) => {
    const row = await lockEditable(tx, id);
    if (row.status !== "DRAFT" && row.status !== "CHANGES_REQUIRED" && ((body.assetType && body.assetType !== row.assetType) || (body.symbol && body.symbol !== row.symbol) || (body.issuerId === null && RWA_ASSET_TYPES.includes(row.assetType)))) throw invalid(LOCKED);
    await assertIssuer(tx, body.issuerId);
    await tx.update(instruments).set({ ...fields, updatedAt: sql`now()` }).where(eq(instruments.id, id));
    let tagChange: { added: string[]; removed: string[] } | undefined;
    if (tagIds) {
      // Tags are descriptive, so they change on a live instrument too: additions must be active tags, removals are timestamped (never deleted).
      const wanted = new Set(tagIds);
      const live = await tx.select({ tagId: instrumentTags.tagId }).from(instrumentTags).where(and(eq(instrumentTags.instrumentId, id), isNull(instrumentTags.removedAt)));
      const liveIds = new Set(live.map((t) => t.tagId));
      const added = [...wanted].filter((t) => !liveIds.has(t));
      const removed = [...liveIds].filter((t) => !wanted.has(t));
      if (added.length) {
        const ok = await tx.select({ id: assetTags.id }).from(assetTags).where(and(inArray(assetTags.id, added), eq(assetTags.status, "active")));
        if (ok.length !== added.length) throw notFound("Tag");
        await tx.insert(instrumentTags).values(added.map((tagId) => ({ instrumentId: id, tagId, addedByUserId: ctx.userId })));
      }
      if (removed.length) await tx.update(instrumentTags).set({ removedAt: sql`now()` }).where(and(eq(instrumentTags.instrumentId, id), inArray(instrumentTags.tagId, removed), isNull(instrumentTags.removedAt)));
      tagChange = { added, removed };
    }
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "instrument", entityId: id, kind: "updated", metadata: { fields: Object.keys(body), tags: tagChange, sector: body.sector } });
  });
  if (body.sector || body.name || tagIds) await refreshBasketsHolding(id);
  return getAssetForOps(id);
}

/** Sector and tags feed the search index of every published basket that holds the instrument. */
async function refreshBasketsHolding(instrumentId: string): Promise<void> {
  const held = await db.selectDistinct({ basketId: baskets.id }).from(baskets)
    .innerJoin(basketVersionAssets, and(eq(basketVersionAssets.versionId, baskets.currentVersionId), eq(basketVersionAssets.revision, sql`(select assets_revision from app.basket_versions where id = ${baskets.currentVersionId})`)))
    .where(eq(basketVersionAssets.instrumentId, instrumentId));
  for (const b of held) await enqueue("search-index-refresh", { basketId: b.basketId });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------------------------------

const tagView = (t: typeof assetTags.$inferSelect): AssetTagView => ({ id: t.id, key: t.key, label: t.label, status: t.status, createdAt: t.createdAt.toISOString(), retiredAt: iso(t.retiredAt) });

export async function listAssetTags(): Promise<ListAssetTagsResponse> {
  return { tags: (await db.select().from(assetTags).orderBy(assetTags.key)).map(tagView) };
}

export async function createAssetTag(ctx: OpsCtx, body: CreateAssetTagRequest): Promise<AssetTagView> {
  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx.insert(assetTags).values({ ...body, createdByUserId: ctx.userId }).returning();
      await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset_tag.created", entityType: "asset_tag", entityId: t!.id, requestId: ctx.meta.requestId, metadata: { key: body.key } });
      return tagView(t!);
    });
  } catch (err) {
    throw isUniqueViolation(err) ? createHttpError("That tag key already exists.", { code: "VALIDATION_FAILED" }) : err;
  }
}

/** A retired tag can no longer be added; instruments keep it until ops remove it, and the search index stops listing it on the next refresh. */
export async function retireAssetTag(ctx: OpsCtx, id: string): Promise<AssetTagView> {
  const view = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(assetTags).where(eq(assetTags.id, id)).for("update");
    if (!t) throw notFound("Tag");
    if (t.status === "retired") return tagView(t);
    const [updated] = await tx.update(assetTags).set({ status: "retired", retiredAt: sql`now()` }).where(eq(assetTags.id, id)).returning();
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset_tag.retired", entityType: "asset_tag", entityId: id, requestId: ctx.meta.requestId, metadata: { key: t.key } });
    return tagView(updated!);
  });
  const tagged = await db.selectDistinct({ instrumentId: instrumentTags.instrumentId }).from(instrumentTags).where(and(eq(instrumentTags.tagId, id), isNull(instrumentTags.removedAt)));
  for (const t of tagged) await refreshBasketsHolding(t.instrumentId);
  return view;
}

// ---------------------------------------------------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------------------------------------------------

const duplicate = (err: unknown): never => {
  throw isUniqueViolation(err) ? createHttpError("This token is already registered.", { code: "DEPLOYMENT_EXISTS" }) : err;
};

/** Reads the token on-chain (before any transaction is open). Non-token addresses yield null observed values, which fail the submit check. */
async function observe(chain: AssetChain, standard: TokenStandard, address: string | null) {
  if (ASSET_CHAINS[chain].verification !== "onchain" || standard === "native") {
    return { verification: "manual" as const, observedDecimals: null, observedSymbol: null, observedName: null, observedAt: null };
  }
  const meta = ASSET_CHAINS[chain].family === "solana"
    ? await getMintDecimals(address!).then((decimals) => (decimals === null ? null : { decimals, symbol: null, name: null }))
    : await readTokenMetadata({ chain, address: address! });
  return { verification: "onchain" as const, observedDecimals: meta?.decimals ?? null, observedSymbol: meta?.symbol ?? null, observedName: meta?.name ?? null, observedAt: new Date() };
}

/** Registry addresses never include Bitcoin: a Bitcoin deployment is the native asset (no address); linking a user address is a separate flow. */
const registryAddress = (chain: Parameters<typeof canonicalizeAddress>[0], raw: string) => {
  if (chain === "bitcoin") throw createHttpError("A Bitcoin deployment is the native asset and has no address.", { code: "VALIDATION_FAILED" });
  return canonicalizeAddress(chain, raw);
};

export async function createDeployment(ctx: OpsCtx, id: string, body: CreateDeploymentRequest): Promise<OpsAssetDetail> {
  const address = body.address === undefined ? null : registryAddress(body.chain, body.address);
  const observed = await observe(body.chain, body.tokenStandard, address);
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [row] = await tx.insert(instrumentDeployments).values({
      instrumentId: id, chain: body.chain, tokenStandard: body.tokenStandard, address, decimals: body.decimals, sourceUrl: body.sourceUrl ?? null, ...observed,
    }).returning({ id: instrumentDeployments.id }).catch(duplicate);
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "deployment", entityId: row!.id, kind: "created", toStatus: "DRAFT", metadata: { chain: body.chain, verification: observed.verification } });
  });
  return getAssetForOps(id);
}

/** Shared by edit and (re-)verify: merges the patch, re-reads the chain when the token identity changed or a verify was asked for, and refuses to write over a concurrent change. */
async function changeDeployment(ctx: OpsCtx, id: string, did: string, patch: UpdateDeploymentRequest, kind: "updated" | "verified"): Promise<OpsAssetDetail> {
  const [pre] = await db.select().from(instrumentDeployments).where(and(eq(instrumentDeployments.id, did), eq(instrumentDeployments.instrumentId, id)));
  if (!pre) throw notFound("Deployment");
  if (pre.status === "RETIRED") throw invalid("This item is retired.");
  const next = createDeploymentRequestSchema.parse({
    chain: patch.chain ?? pre.chain, tokenStandard: patch.tokenStandard ?? pre.tokenStandard, address: patch.address ?? pre.address ?? undefined,
    decimals: patch.decimals ?? pre.decimals, sourceUrl: patch.sourceUrl === undefined ? pre.sourceUrl : patch.sourceUrl,
  });
  const address = next.address === undefined ? null : registryAddress(next.chain, next.address);
  const identityChanged = next.chain !== pre.chain || next.tokenStandard !== pre.tokenStandard || address !== pre.address;
  if (kind === "verified") {
    if (pre.status !== "DRAFT") throw invalid("Only a draft deployment can be re-verified.");
    if (pre.verification !== "onchain") throw invalid("This deployment is verified manually.");
  } else if (pre.status !== "DRAFT" && (identityChanged || next.decimals !== pre.decimals || (pre.verification === "manual" && (next.sourceUrl ?? null) !== pre.sourceUrl))) {
    throw invalid(LOCKED);
  }
  const observed = identityChanged || kind === "verified" ? await observe(next.chain, next.tokenStandard, address) : {};
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [row] = await tx.select().from(instrumentDeployments).where(eq(instrumentDeployments.id, did)).for("update");
    if (row!.updatedAt.getTime() !== pre.updatedAt.getTime()) throw invalid("This deployment changed. Reload and try again.");
    await tx.update(instrumentDeployments).set({
      chain: next.chain, tokenStandard: next.tokenStandard, address, decimals: next.decimals, sourceUrl: next.sourceUrl ?? null, ...observed, updatedAt: sql`now()`,
    }).where(eq(instrumentDeployments.id, did)).catch(duplicate);
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "deployment", entityId: did, kind, fromStatus: pre.status, toStatus: pre.status, metadata: { fields: Object.keys(patch) } });
  });
  return getAssetForOps(id);
}

export const updateDeployment = (ctx: OpsCtx, id: string, did: string, body: UpdateDeploymentRequest) => changeDeployment(ctx, id, did, body, "updated");

/** The fee-on-transfer flag: an ops_admin note for previews, no effect on identity, so it is editable while the asset is active; recorded as an asset event and audited. */
export async function setFeeOnTransfer(ctx: OpsCtx, id: string, did: string, feeOnTransfer: boolean): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockInstrument(tx, id);
    const [row] = await tx.select().from(instrumentDeployments).where(and(eq(instrumentDeployments.id, did), eq(instrumentDeployments.instrumentId, id))).for("update");
    if (!row) throw notFound("Deployment");
    if (row.feeOnTransfer === feeOnTransfer) return;
    await tx.update(instrumentDeployments).set({ feeOnTransfer, updatedAt: sql`now()` }).where(eq(instrumentDeployments.id, did));
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "deployment", entityId: did, kind: "updated", fromStatus: row.status, toStatus: row.status, metadata: { feeOnTransfer } });
  });
  return getAssetForOps(id);
}

export async function verifyDeployment(ctx: OpsCtx, id: string, did: string): Promise<OpsAssetDetail> {
  await consume(limits.assetVerifyUser, ctx.userId);
  return changeDeployment(ctx, id, did, {}, "verified");
}

// ---------------------------------------------------------------------------------------------------------------------
// Routes and eligibility rules
// ---------------------------------------------------------------------------------------------------------------------

async function assertRouteRefs(tx: Tx, instrumentId: string, refs: { deploymentId?: string; providerId?: string; settlementInstrumentId?: string | null }): Promise<void> {
  if (refs.deploymentId) {
    const [d] = await tx.select({ id: instrumentDeployments.id }).from(instrumentDeployments).where(and(eq(instrumentDeployments.id, refs.deploymentId), eq(instrumentDeployments.instrumentId, instrumentId), ne(instrumentDeployments.status, "RETIRED")));
    if (!d) throw notFound("Deployment");
  }
  if (refs.providerId) {
    const [p] = await tx.select({ id: assetProviders.id }).from(assetProviders).where(eq(assetProviders.id, refs.providerId));
    if (!p) throw notFound("Provider");
  }
  if (refs.settlementInstrumentId) {
    const [s] = await tx.select({ id: instruments.id }).from(instruments).where(eq(instruments.id, refs.settlementInstrumentId));
    if (!s) throw notFound("Settlement asset");
  }
}

export async function createRoute(ctx: OpsCtx, id: string, body: CreateRouteRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    await assertRouteRefs(tx, id, body);
    const [row] = await tx.insert(executionRoutes).values({ ...body, instrumentId: id }).returning({ id: executionRoutes.id });
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "route", entityId: row!.id, kind: "created", toStatus: "DRAFT" });
  });
  return getAssetForOps(id);
}

export async function updateRoute(ctx: OpsCtx, id: string, rid: string, body: UpdateRouteRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [route] = await tx.select().from(executionRoutes).where(and(eq(executionRoutes.id, rid), eq(executionRoutes.instrumentId, id))).for("update");
    if (!route) throw notFound("Route");
    if (route.status === "RETIRED") throw invalid("This item is retired.");
    if (route.status !== "DRAFT" && (
      (body.deploymentId && body.deploymentId !== route.deploymentId) || (body.method && body.method !== route.method) || (body.providerId && body.providerId !== route.providerId)
      || (body.settlementInstrumentId !== undefined && body.settlementInstrumentId !== route.settlementInstrumentId)
    )) throw invalid(LOCKED);
    await assertRouteRefs(tx, id, body);
    await tx.update(executionRoutes).set({ ...body, updatedAt: sql`now()` }).where(eq(executionRoutes.id, rid));
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "route", entityId: rid, kind: "updated", fromStatus: route.status, toStatus: route.status, metadata: { fields: Object.keys(body) } });
  });
  return getAssetForOps(id);
}

export async function createRule(ctx: OpsCtx, id: string, body: CreateRuleRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    if (body.routeId) {
      const [route] = await tx.select({ id: executionRoutes.id }).from(executionRoutes).where(and(eq(executionRoutes.id, body.routeId), eq(executionRoutes.instrumentId, id)));
      if (!route) throw notFound("Route");
    }
    const [row] = await tx.insert(eligibilityRules).values({ ...body, instrumentId: id }).returning({ id: eligibilityRules.id });
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "rule", entityId: row!.id, kind: "created", toStatus: "ACTIVE" });
  });
  return getAssetForOps(id);
}

export async function updateRule(ctx: OpsCtx, id: string, ruleId: string, body: UpdateRuleRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [rule] = await tx.select().from(eligibilityRules).where(and(eq(eligibilityRules.id, ruleId), eq(eligibilityRules.instrumentId, id))).for("update");
    if (!rule) throw notFound("Rule");
    if (rule.status === "RETIRED") throw invalid("This item is retired.");
    if (body.routeId) {
      const [route] = await tx.select({ id: executionRoutes.id }).from(executionRoutes).where(and(eq(executionRoutes.id, body.routeId), eq(executionRoutes.instrumentId, id)));
      if (!route) throw notFound("Route");
    }
    await tx.update(eligibilityRules).set({ ...body, updatedAt: sql`now()` }).where(eq(eligibilityRules.id, ruleId));
    await recordAssetEvent(tx, ctx, {
      instrumentId: id, entityType: "rule", entityId: ruleId, kind: body.status === "RETIRED" ? "retired" : "updated", fromStatus: rule.status, toStatus: body.status ?? rule.status,
      metadata: { fields: Object.keys(body) },
    });
  });
  return getAssetForOps(id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------------------------------

/** Replaces the active reference of `kind`: the old one is retired, history stays. */
export async function putPriceReference(ctx: OpsCtx, id: string, kind: "market" | "nav", body: PutPriceReferenceRequest): Promise<OpsAssetDetail> {
  if (kind === "market" && !body.externalId) throw createHttpError("A CoinMarketCap id is required for a market price.", { code: "VALIDATION_FAILED" });
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [old] = await tx.update(priceReferences).set({ status: "RETIRED", updatedAt: sql`now()` })
      .where(and(eq(priceReferences.instrumentId, id), eq(priceReferences.kind, kind), eq(priceReferences.status, "ACTIVE"))).returning({ id: priceReferences.id });
    if (old) await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "price", entityId: old.id, kind: "retired", fromStatus: "ACTIVE", toStatus: "RETIRED", metadata: { priceKind: kind } });
    const [row] = await tx.insert(priceReferences).values({
      instrumentId: id, kind, provider: kind === "market" ? "coinmarketcap" : "issuer", externalId: kind === "market" ? body.externalId : null,
    }).returning({ id: priceReferences.id });
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "price", entityId: row!.id, kind: "created", toStatus: "ACTIVE", metadata: { priceKind: kind } });
  });
  return getAssetForOps(id);
}

export async function recordNav(ctx: OpsCtx, id: string, body: NavEntryRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    await lockEditable(tx, id);
    const [ref] = await tx.select({ id: priceReferences.id }).from(priceReferences).where(and(eq(priceReferences.instrumentId, id), eq(priceReferences.kind, "nav"), eq(priceReferences.status, "ACTIVE")));
    if (!ref) throw invalid("Add a NAV price reference first.");
    await tx.insert(navObservations).values({ priceReferenceId: ref.id, value: body.value, asOf: body.asOf, sourceUrl: body.sourceUrl, enteredByUserId: ctx.userId });
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "price", entityId: ref.id, kind: "nav_recorded", metadata: { asOf: body.asOf } });
  });
  return getAssetForOps(id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Issuers and providers (reference records: audited, no instrument event)
// ---------------------------------------------------------------------------------------------------------------------

const refView = <T extends { createdAt: Date; updatedAt: Date }>(row: T) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const nameTaken = (err: unknown): never => {
  throw isUniqueViolation(err) ? createHttpError("A record with this name already exists.", { code: "VALIDATION_FAILED" }) : err;
};

export async function listIssuers(): Promise<IssuerView[]> {
  return (await db.select().from(assetIssuers).orderBy(assetIssuers.name)).map(refView);
}

export async function createIssuer(ctx: OpsCtx, body: IssuerRequest): Promise<IssuerView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(assetIssuers).values(body).returning().catch(nameTaken);
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset.issuer.created", entityType: "issuer", entityId: row!.id, requestId: ctx.meta.requestId });
    return refView(row!);
  });
}

export async function updateIssuer(ctx: OpsCtx, id: string, body: UpdateIssuerRequest): Promise<IssuerView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(assetIssuers).set({ ...body, updatedAt: sql`now()` }).where(eq(assetIssuers.id, id)).returning().catch(nameTaken);
    if (!row) throw notFound("Issuer");
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset.issuer.updated", entityType: "issuer", entityId: id, requestId: ctx.meta.requestId, metadata: { fields: Object.keys(body) } });
    return refView(row);
  });
}

export async function listAssetProviders(): Promise<AssetProviderView[]> {
  return (await db.select().from(assetProviders).orderBy(assetProviders.name)).map(refView);
}

export async function createAssetProvider(ctx: OpsCtx, body: AssetProviderRequest): Promise<AssetProviderView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(assetProviders).values(body).returning().catch(nameTaken);
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset.provider.created", entityType: "asset_provider", entityId: row!.id, requestId: ctx.meta.requestId });
    return refView(row!);
  });
}

export async function updateAssetProvider(ctx: OpsCtx, id: string, body: UpdateAssetProviderRequest): Promise<AssetProviderView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(assetProviders).set({ ...body, updatedAt: sql`now()` }).where(eq(assetProviders.id, id)).returning().catch(nameTaken);
    if (!row) throw notFound("Provider");
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset.provider.updated", entityType: "asset_provider", entityId: id, requestId: ctx.meta.requestId, metadata: { fields: Object.keys(body) } });
    return refView(row);
  });
}
