import { z } from "zod";
import { investorStatusSchema } from "./eligibility";

// ---------------------------------------------------------------------------------------------------------------------
// Enums and lifecycle
// ---------------------------------------------------------------------------------------------------------------------

export const assetChainSchema = z.enum(["solana", "ethereum", "base", "bnb", "arbitrum", "polygon", "bitcoin"]);
export type AssetChain = z.infer<typeof assetChainSchema>;
/** Recording a chain here does not make it executable. Independent of the auth `CHAINS`. */
export const ASSET_CHAINS: Readonly<Record<AssetChain, { label: string; family: "evm" | "solana" | "bitcoin"; verification: "onchain" | "manual" }>> = {
  solana: { label: "Solana", family: "solana", verification: "onchain" },
  ethereum: { label: "Ethereum", family: "evm", verification: "onchain" },
  base: { label: "Base", family: "evm", verification: "onchain" },
  bnb: { label: "BNB Chain", family: "evm", verification: "onchain" },
  arbitrum: { label: "Arbitrum", family: "evm", verification: "onchain" },
  polygon: { label: "Polygon", family: "evm", verification: "manual" },
  bitcoin: { label: "Bitcoin", family: "bitcoin", verification: "manual" },
};

export const INSTRUMENT_SECTORS = [
  "store_of_value", "smart_contract_platform", "layer2", "defi", "stablecoin", "oracle_infra", "gaming_metaverse", "ai_data", "meme", "rwa_treasury", "rwa_credit", "rwa_commodity", "rwa_equity", "other",
] as const;
export const instrumentSectorSchema = z.enum(INSTRUMENT_SECTORS);
export type InstrumentSector = z.infer<typeof instrumentSectorSchema>;

export const assetTypeSchema = z.enum([
  "CRYPTO", "STABLECOIN", "TOKENIZED_TREASURY", "TOKENIZED_EQUITY", "TOKENIZED_FUND", "TOKENIZED_BOND", "TOKENIZED_COMMODITY", "TOKENIZED_PRIVATE_CREDIT", "TOKENIZED_OTHER",
]);
export type AssetType = z.infer<typeof assetTypeSchema>;
export const RWA_ASSET_TYPES: readonly AssetType[] = assetTypeSchema.options.filter((t) => t.startsWith("TOKENIZED_"));

export const tokenStandardSchema = z.enum(["native", "erc20", "spl", "spl_token_2022", "other"]);
export type TokenStandard = z.infer<typeof tokenStandardSchema>;

export const INSTRUMENT_STATUSES = ["DRAFT", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED", "ACTIVE", "PAUSED", "DEPRECATED", "RETIRED"] as const;
export const instrumentStatusSchema = z.enum(INSTRUMENT_STATUSES);
export type InstrumentStatus = z.infer<typeof instrumentStatusSchema>;

export const ASSET_ITEM_STATUSES = ["DRAFT", "APPROVED", "ACTIVE", "PAUSED", "RETIRED"] as const;
export const assetItemStatusSchema = z.enum(ASSET_ITEM_STATUSES);
export type AssetItemStatus = z.infer<typeof assetItemStatusSchema>;

export const ruleStatusSchema = z.enum(["DRAFT", "ACTIVE", "RETIRED"]);
export const executionMethodSchema = z.enum(["swap", "subscription", "secondary_market", "platform_inventory", "redemption", "cross_chain_transfer"]);
export const processingModelSchema = z.enum(["sync", "async"]);
export const eligibilityActionSchema = z.enum(["acquire", "sell", "redeem", "transfer"]);
export const eligibilityOutcomeSchema = z.enum(["ALLOWED", "RESTRICTED", "KYC_REQUIRED", "REVIEW_REQUIRED"]);
export const priceKindSchema = z.enum(["market", "nav"]);
export const assetProviderKindSchema = z.enum(["dex_aggregator", "issuer_platform", "venue", "bridge", "other"]);

export const INSTRUMENT_TRANSITIONS: Readonly<Record<InstrumentStatus, readonly InstrumentStatus[]>> = {
  DRAFT: ["UNDER_REVIEW", "RETIRED"],
  UNDER_REVIEW: ["APPROVED", "CHANGES_REQUIRED"],
  CHANGES_REQUIRED: ["UNDER_REVIEW", "RETIRED"],
  APPROVED: ["ACTIVE", "RETIRED"],
  ACTIVE: ["PAUSED", "DEPRECATED"],
  PAUSED: ["ACTIVE", "DEPRECATED"],
  DEPRECATED: ["RETIRED"],
  RETIRED: [],
};
export const ASSET_ITEM_TRANSITIONS: Readonly<Record<AssetItemStatus, readonly AssetItemStatus[]>> = {
  DRAFT: ["APPROVED", "RETIRED"],
  APPROVED: ["ACTIVE", "RETIRED"],
  ACTIVE: ["PAUSED", "RETIRED"],
  PAUSED: ["ACTIVE", "RETIRED"],
  RETIRED: [],
};
/** Stable keys in `details.missing` of a 422 REQUIREMENTS_INCOMPLETE. */
export const ASSET_REQUIREMENT_KEYS = ["deployment", "deployment_verification", "deployment_source_url", "market_price_reference", "issuer", "route", "eligibility_rule"] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const httpsUrl = z.url({ protocol: /^https$/ }).max(500);
const decimalString = z.string().regex(/^\d{1,20}(\.\d{1,18})?$/);
const uuid = z.uuid();

const linkSchema = z.object({ label: text(1, 60), url: httpsUrl });

const instrumentFields = {
  name: text(2, 120),
  symbol: text(1, 20).transform((s) => s.toUpperCase()),
  assetType: assetTypeSchema,
  description: z.string().trim().max(2000),
  issuerId: uuid.nullable(),
  riskNotes: z.string().trim().max(2000),
  links: z.array(linkSchema).max(10),
};
export const createInstrumentRequestSchema = z.object({ ...instrumentFields, description: instrumentFields.description.optional(), issuerId: uuid.nullable().optional(), riskNotes: instrumentFields.riskNotes.optional(), links: instrumentFields.links.optional() });
export type CreateInstrumentRequest = z.infer<typeof createInstrumentRequestSchema>;
/** Sector and tags are descriptive: ops may change them on a live instrument. */
export const updateInstrumentRequestSchema = z.object({ ...instrumentFields, sector: instrumentSectorSchema, tagIds: z.array(uuid).max(20) }).partial();
export type UpdateInstrumentRequest = z.infer<typeof updateInstrumentRequestSchema>;

const deploymentFields = {
  chain: assetChainSchema,
  tokenStandard: tokenStandardSchema,
  address: text(1, 100),
  decimals: z.number().int().min(0).max(36),
  sourceUrl: httpsUrl.nullable(),
};
export const createDeploymentRequestSchema = z.object({ ...deploymentFields, address: deploymentFields.address.optional(), sourceUrl: deploymentFields.sourceUrl.optional() })
  .refine((d) => (d.tokenStandard === "native") === (d.address === undefined), { message: "Native assets have no address; every other standard needs one.", path: ["address"] })
  .refine((d) => d.chain !== "bitcoin" || d.tokenStandard === "native", { message: "Bitcoin deployments are native only.", path: ["tokenStandard"] })
  .refine((d) => d.tokenStandard !== "erc20" || ASSET_CHAINS[d.chain].family === "evm", { message: "ERC-20 tokens live on EVM chains.", path: ["tokenStandard"] })
  .refine((d) => !d.tokenStandard.startsWith("spl") || d.chain === "solana", { message: "SPL tokens live on Solana.", path: ["tokenStandard"] });
export type CreateDeploymentRequest = z.infer<typeof createDeploymentRequestSchema>;
/** Ops flag (ops_admin): a permissioned token is never investable (Spec 11). */
export const permissionedRequestSchema = z.object({ permissioned: z.boolean() });
export type PermissionedRequest = z.infer<typeof permissionedRequestSchema>;
export const feeOnTransferRequestSchema = z.object({ feeOnTransfer: z.boolean() });
export type FeeOnTransferRequest = z.infer<typeof feeOnTransferRequestSchema>;
export const updateDeploymentRequestSchema = z.object(deploymentFields).partial();
export type UpdateDeploymentRequest = z.infer<typeof updateDeploymentRequestSchema>;

const routeFields = {
  deploymentId: uuid,
  providerId: uuid,
  venue: text(1, 120),
  method: executionMethodSchema,
  settlementInstrumentId: uuid.nullable(),
  minimumAmount: decimalString.nullable(),
  processingModel: processingModelSchema,
  notes: z.string().trim().max(2000),
};
export const createRouteRequestSchema = z.object({ ...routeFields, settlementInstrumentId: routeFields.settlementInstrumentId.optional(), minimumAmount: routeFields.minimumAmount.optional(), notes: routeFields.notes.optional() });
export type CreateRouteRequest = z.infer<typeof createRouteRequestSchema>;
export const updateRouteRequestSchema = z.object(routeFields).partial();
export type UpdateRouteRequest = z.infer<typeof updateRouteRequestSchema>;

const ruleFields = {
  routeId: uuid.nullable(),
  jurisdiction: z.string().regex(/^([A-Z]{2}|\*)$/),
  action: eligibilityActionSchema,
  outcome: eligibilityOutcomeSchema,
  /** Empty = every investor status. */
  investorStatuses: z.array(investorStatusSchema).max(4).refine((a) => new Set(a).size === a.length),
  kycRequirement: z.string().trim().max(500),
  transferRestrictions: z.string().trim().max(1000),
  sourceText: z.string().trim().max(500),
  sourceUrl: httpsUrl.nullable(),
};
export const createRuleRequestSchema = z.object({
  ...ruleFields, investorStatuses: ruleFields.investorStatuses.default([]), routeId: ruleFields.routeId.optional(), kycRequirement: ruleFields.kycRequirement.optional(), transferRestrictions: ruleFields.transferRestrictions.optional(),
  sourceText: ruleFields.sourceText.optional(), sourceUrl: ruleFields.sourceUrl.optional(),
});
export type CreateRuleRequest = z.infer<typeof createRuleRequestSchema>;
export const updateRuleRequestSchema = z.object({ ...ruleFields, status: ruleStatusSchema }).partial();
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;

/** `externalId` (CoinMarketCap numeric id) is required for `market` and ignored for `nav`; the service enforces it. */
export const putPriceReferenceRequestSchema = z.object({ externalId: z.string().regex(/^\d{1,10}$/).optional() });
export type PutPriceReferenceRequest = z.infer<typeof putPriceReferenceRequestSchema>;
export const navEntryRequestSchema = z.object({ value: decimalString, asOf: z.iso.date(), sourceUrl: httpsUrl });
export type NavEntryRequest = z.infer<typeof navEntryRequestSchema>;

const issuerFields = { name: text(2, 120), legalName: text(1, 200), website: httpsUrl, jurisdiction: z.string().regex(/^[A-Z]{2}$/), notes: z.string().trim().max(2000) };
export const issuerRequestSchema = z.object({ name: issuerFields.name, legalName: issuerFields.legalName.optional(), website: issuerFields.website.optional(), jurisdiction: issuerFields.jurisdiction.optional(), notes: issuerFields.notes.optional() });
export type IssuerRequest = z.infer<typeof issuerRequestSchema>;
export const updateIssuerRequestSchema = z.object(issuerFields).partial();
export type UpdateIssuerRequest = z.infer<typeof updateIssuerRequestSchema>;

const providerFields = { name: text(2, 120), kind: assetProviderKindSchema, website: httpsUrl, notes: z.string().trim().max(2000) };
export const assetProviderRequestSchema = z.object({ name: providerFields.name, kind: providerFields.kind, website: providerFields.website.optional(), notes: providerFields.notes.optional() });
export type AssetProviderRequest = z.infer<typeof assetProviderRequestSchema>;
export const updateAssetProviderRequestSchema = z.object(providerFields).partial();
export type UpdateAssetProviderRequest = z.infer<typeof updateAssetProviderRequestSchema>;

export const assetDecisionRequestSchema = z.object({
  decision: z.enum(["approved", "changes_required"]),
  message: text(1, 2000).optional(),
  internalNote: text(1, 2000).optional(),
}).refine((d) => d.decision !== "changes_required" || d.message !== undefined, { message: "A message is required when asking for changes.", path: ["message"] });
export type AssetDecisionRequest = z.infer<typeof assetDecisionRequestSchema>;

export const opsAssetListQuerySchema = z.object({
  status: instrumentStatusSchema.optional(),
  type: assetTypeSchema.optional(),
  chain: assetChainSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});
export type OpsAssetListQuery = z.input<typeof opsAssetListQuerySchema>;
export const assetListQuerySchema = opsAssetListQuerySchema.omit({ status: true });
export type AssetListQuery = z.input<typeof assetListQuerySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------

const isoTime = z.iso.datetime({ offset: true });
const links = z.array(linkSchema);

export const priceViewSchema = z.object({
  instrumentId: uuid,
  kind: priceKindSchema,
  status: z.enum(["ok", "unavailable"]),
  value: z.string().nullable(),
  currency: z.literal("USD"),
  source: z.enum(["coinmarketcap", "issuer"]),
  observedAt: z.string().nullable(),
  stale: z.boolean(),
});
export type PriceView = z.infer<typeof priceViewSchema>;

export const opsAssetSummarySchema = z.object({
  id: uuid, name: z.string(), symbol: z.string(), assetType: assetTypeSchema, status: instrumentStatusSchema, chains: z.array(assetChainSchema), updatedAt: isoTime,
});
export type OpsAssetSummary = z.infer<typeof opsAssetSummarySchema>;
export const opsAssetListResponseSchema = z.object({ items: z.array(opsAssetSummarySchema), nextCursor: z.string().nullable() });
export type OpsAssetListResponse = z.infer<typeof opsAssetListResponseSchema>;

export const opsAssetDetailSchema = z.object({
  id: uuid, name: z.string(), symbol: z.string(), assetType: assetTypeSchema, description: z.string().nullable(), issuerId: uuid.nullable(), riskNotes: z.string().nullable(), links,
  sector: instrumentSectorSchema, tags: z.array(z.object({ id: uuid, key: z.string(), label: z.string() })),
  status: instrumentStatusSchema, createdByUserId: uuid, submittedByUserId: uuid.nullable(), decidedByUserId: uuid.nullable(), createdAt: isoTime, updatedAt: isoTime,
  deployments: z.array(z.object({
    id: uuid, chain: assetChainSchema, tokenStandard: tokenStandardSchema, address: z.string().nullable(), decimals: z.number().int(), verification: z.enum(["onchain", "manual"]),
    observedDecimals: z.number().int().nullable(), observedSymbol: z.string().nullable(), observedName: z.string().nullable(), observedAt: isoTime.nullable(), sourceUrl: z.string().nullable(),
    /** Ops flag: the token takes a fee on transfer (previews warn that less can arrive). */
    feeOnTransfer: z.boolean(),
    /** Ops flag: permissioned tokens are never investable. */
    permissioned: z.boolean(),
    /** LI.FI token list: listed = verified; null when unknown (native asset, Bitcoin, LI.FI unavailable). */
    lifiVerification: z.enum(["verified", "unverified", "flagged"]).nullable(),
    status: assetItemStatusSchema, approvedByUserId: uuid.nullable(), createdAt: isoTime, updatedAt: isoTime,
  })),
  routes: z.array(z.object({
    id: uuid, deploymentId: uuid, providerId: uuid, venue: z.string(), method: executionMethodSchema, settlementInstrumentId: uuid.nullable(), minimumAmount: z.string().nullable(),
    processingModel: processingModelSchema, notes: z.string().nullable(), status: assetItemStatusSchema, approvedByUserId: uuid.nullable(), createdAt: isoTime, updatedAt: isoTime,
  })),
  rules: z.array(z.object({
    id: uuid, routeId: uuid.nullable(), jurisdiction: z.string(), action: eligibilityActionSchema, outcome: eligibilityOutcomeSchema, investorStatuses: z.array(investorStatusSchema), kycRequirement: z.string().nullable(),
    transferRestrictions: z.string().nullable(), sourceText: z.string().nullable(), sourceUrl: z.string().nullable(), status: ruleStatusSchema, createdAt: isoTime, updatedAt: isoTime,
  })),
  priceReferences: z.array(z.object({
    id: uuid, kind: priceKindSchema, provider: z.enum(["coinmarketcap", "issuer"]), externalId: z.string().nullable(), quoteCurrency: z.literal("USD"), status: ruleStatusSchema, createdAt: isoTime,
  })),
  navObservations: z.array(z.object({
    id: uuid, priceReferenceId: uuid, value: z.string(), currency: z.literal("USD"), asOf: z.string(), sourceUrl: z.string(), enteredByUserId: uuid, createdAt: isoTime,
  })),
  events: z.array(z.object({
    id: uuid, entityType: z.string(), entityId: uuid, kind: z.string(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), actorUserId: uuid.nullable(),
    message: z.string().nullable(), internalNote: z.string().nullable(), createdAt: isoTime,
  })),
  missing: z.array(z.string()),
  /** Review warnings (Spec 11): a tokenized asset without an ACTIVE eligibility rule is restricted everywhere. */
  warnings: z.array(z.string()),
  prices: z.array(priceViewSchema),
});
export type OpsAssetDetail = z.infer<typeof opsAssetDetailSchema>;

export const issuerViewSchema = z.object({
  id: uuid, name: z.string(), legalName: z.string().nullable(), website: z.string().nullable(), jurisdiction: z.string().nullable(), notes: z.string().nullable(), createdAt: isoTime, updatedAt: isoTime,
});
export type IssuerView = z.infer<typeof issuerViewSchema>;
export const assetProviderViewSchema = z.object({
  id: uuid, name: z.string(), kind: assetProviderKindSchema, website: z.string().nullable(), notes: z.string().nullable(), createdAt: isoTime, updatedAt: isoTime,
});
export type AssetProviderView = z.infer<typeof assetProviderViewSchema>;

export const publicAssetSummarySchema = z.object({ id: uuid, name: z.string(), symbol: z.string(), assetType: assetTypeSchema, chains: z.array(assetChainSchema) });
export type PublicAssetSummary = z.infer<typeof publicAssetSummarySchema>;
export const publicAssetListResponseSchema = z.object({ items: z.array(publicAssetSummarySchema), nextCursor: z.string().nullable() });
export type PublicAssetListResponse = z.infer<typeof publicAssetListResponseSchema>;

/** The session-user allow-list (spec 8). Rules, review messages, observed metadata and actor ids are never part of it. */
export const publicAssetDetailSchema = z.object({
  id: uuid, name: z.string(), symbol: z.string(), assetType: assetTypeSchema, description: z.string().nullable(),
  issuer: z.object({ name: z.string(), website: z.string().nullable() }).nullable(), riskNotes: z.string().nullable(), links,
  deployments: z.array(z.object({ chain: assetChainSchema, tokenStandard: tokenStandardSchema, address: z.string().nullable(), decimals: z.number().int() })),
  routes: z.array(z.object({
    chain: assetChainSchema, method: executionMethodSchema, providerName: z.string(), settlementSymbol: z.string().nullable(), minimumAmount: z.string().nullable(), processingModel: processingModelSchema,
  })),
  prices: z.array(priceViewSchema),
});
export type PublicAssetDetail = z.infer<typeof publicAssetDetailSchema>;
