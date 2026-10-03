import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, date, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app } from "./enums";
import { users } from "./identity";

export const assetType = app.enum("asset_type", [
  "CRYPTO", "STABLECOIN", "TOKENIZED_TREASURY", "TOKENIZED_EQUITY", "TOKENIZED_FUND", "TOKENIZED_BOND", "TOKENIZED_COMMODITY", "TOKENIZED_PRIVATE_CREDIT", "TOKENIZED_OTHER",
]);
export const assetChain = app.enum("asset_chain", ["solana", "ethereum", "base", "bnb", "arbitrum", "polygon", "bitcoin"]);
export const tokenStandard = app.enum("token_standard", ["native", "erc20", "spl", "spl_token_2022", "other"]);
export const instrumentStatus = app.enum("instrument_status", ["DRAFT", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED", "ACTIVE", "PAUSED", "DEPRECATED", "RETIRED"]);
export const instrumentSector = app.enum("instrument_sector", [
  "store_of_value", "smart_contract_platform", "layer2", "defi", "stablecoin", "oracle_infra", "gaming_metaverse", "ai_data", "meme", "rwa_treasury", "rwa_credit", "rwa_commodity", "rwa_equity", "other",
]);
export const assetItemStatus = app.enum("asset_item_status", ["DRAFT", "APPROVED", "ACTIVE", "PAUSED", "RETIRED"]);
export const ruleStatus = app.enum("rule_status", ["DRAFT", "ACTIVE", "RETIRED"]);
export const deploymentVerification = app.enum("deployment_verification", ["onchain", "manual"]);
export const executionMethod = app.enum("execution_method", ["swap", "subscription", "secondary_market", "platform_inventory", "redemption", "cross_chain_transfer"]);
export const processingModel = app.enum("processing_model", ["sync", "async"]);
export const eligibilityAction = app.enum("eligibility_action", ["acquire", "sell", "redeem", "transfer"]);
export const eligibilityOutcome = app.enum("eligibility_outcome", ["ALLOWED", "RESTRICTED", "KYC_REQUIRED", "REVIEW_REQUIRED"]);
export const investorStatus = app.enum("investor_status", ["retail", "accredited", "qualified", "professional"]);
export const priceKind = app.enum("price_kind", ["market", "nav"]);
export const priceProvider = app.enum("price_provider", ["coinmarketcap", "issuer"]);
export const assetProviderKind = app.enum("asset_provider_kind", ["dex_aggregator", "issuer_platform", "venue", "bridge", "other"]);
export const assetEventEntity = app.enum("asset_event_entity", ["instrument", "deployment", "route", "rule", "price"]);
export const assetEventKind = app.enum("asset_event_kind", [
  "created", "updated", "verified", "submitted", "decided", "approved", "activated", "paused", "resumed", "deprecated", "retired", "nav_recorded",
]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const assetIssuers = app.table("asset_issuers", {
  id: id(),
  name: text("name").notNull().unique(),
  legalName: text("legal_name"),
  website: text("website"),
  /** ISO 3166-1 alpha-2. */
  jurisdiction: text("jurisdiction"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const assetProviders = app.table("asset_providers", {
  id: id(),
  name: text("name").notNull().unique(),
  kind: assetProviderKind("kind").notNull(),
  website: text("website"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const instruments = app.table(
  "instruments",
  {
    id: id(),
    name: text("name").notNull(),
    /** Uppercase. */
    symbol: text("symbol").notNull(),
    assetType: assetType("asset_type").notNull(),
    description: text("description"),
    issuerId: uuid("issuer_id").references(() => assetIssuers.id),
    riskNotes: text("risk_notes"),
    sector: instrumentSector("sector").notNull().default("other"),
    /** `{ label, url }[]`, https only, at most 10. */
    links: jsonb("links").$type<Array<{ label: string; url: string }>>().notNull().default([]),
    status: instrumentStatus("status").notNull().default("DRAFT"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("instruments_queue_idx").on(t.updatedAt, t.id)],
);

export const instrumentDeployments = app.table(
  "instrument_deployments",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    chain: assetChain("chain").notNull(),
    tokenStandard: tokenStandard("token_standard").notNull(),
    /** Canonical per chain family. Null only for `native`. */
    address: text("address"),
    decimals: integer("decimals").notNull(),
    verification: deploymentVerification("verification").notNull(),
    observedDecimals: integer("observed_decimals"),
    observedSymbol: text("observed_symbol"),
    observedName: text("observed_name"),
    observedAt: ts("observed_at"),
    sourceUrl: text("source_url"),
    /** Ops flag: the token takes a fee on transfer, so the received amount can be below the quote (previews say so; the ledger is unchanged). */
    feeOnTransfer: boolean("fee_on_transfer").notNull().default(false),
    /** Ops flag: the token restricts who can hold it, so it is never investable (Spec 11). */
    permissioned: boolean("permissioned").notNull().default(false),
    status: assetItemStatus("status").notNull().default("DRAFT"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instrument_deployments_chain_address_live").on(t.chain, t.address).where(sql`${t.address} is not null and ${t.status} <> 'RETIRED'`),
    uniqueIndex("instrument_deployments_native_live").on(t.instrumentId, t.chain).where(sql`${t.tokenStandard} = 'native' and ${t.status} <> 'RETIRED'`),
    index("instrument_deployments_instrument_idx").on(t.instrumentId),
    check("instrument_deployments_address_iff_not_native", sql`(${t.address} is null) = (${t.tokenStandard} = 'native')`),
    check("instrument_deployments_decimals_range", sql`${t.decimals} between 0 and 36`),
  ],
);

export const executionRoutes = app.table(
  "execution_routes",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    deploymentId: uuid("deployment_id").notNull().references(() => instrumentDeployments.id),
    providerId: uuid("provider_id").notNull().references(() => assetProviders.id),
    venue: text("venue").notNull(),
    method: executionMethod("method").notNull(),
    settlementInstrumentId: uuid("settlement_instrument_id").references(() => instruments.id),
    /** Settlement units, decimal string in JSON. */
    minimumAmount: numeric("minimum_amount"),
    processingModel: processingModel("processing_model").notNull(),
    notes: text("notes"),
    status: assetItemStatus("status").notNull().default("DRAFT"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("execution_routes_instrument_idx").on(t.instrumentId)],
);

export const eligibilityRules = app.table(
  "eligibility_rules",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    /** Null = all routes of the instrument. */
    routeId: uuid("route_id").references(() => executionRoutes.id),
    /** ISO 3166-1 alpha-2 or `*`. */
    jurisdiction: text("jurisdiction").notNull(),
    action: eligibilityAction("action").notNull(),
    outcome: eligibilityOutcome("outcome").notNull(),
    /** Empty = every investor status. */
    investorStatuses: investorStatus("investor_statuses").array().notNull().default(sql`'{}'::app.investor_status[]`),
    kycRequirement: text("kyc_requirement"),
    transferRestrictions: text("transfer_restrictions"),
    sourceText: text("source_text"),
    sourceUrl: text("source_url"),
    status: ruleStatus("status").notNull().default("ACTIVE"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("eligibility_rules_instrument_idx").on(t.instrumentId)],
);

export const priceReferences = app.table(
  "price_references",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    kind: priceKind("kind").notNull(),
    provider: priceProvider("provider").notNull(),
    /** CoinMarketCap numeric id as text; null for `issuer`. */
    externalId: text("external_id"),
    quoteCurrency: text("quote_currency").notNull().default("USD"),
    status: ruleStatus("status").notNull().default("ACTIVE"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_references_one_active").on(t.instrumentId, t.kind).where(sql`${t.status} = 'ACTIVE'`),
    check("price_references_kind_provider", sql`(${t.kind} = 'market' and ${t.provider} = 'coinmarketcap' and ${t.externalId} is not null) or (${t.kind} = 'nav' and ${t.provider} = 'issuer' and ${t.externalId} is null)`),
  ],
);

/** Append-only. */
export const navObservations = app.table(
  "nav_observations",
  {
    id: id(),
    priceReferenceId: uuid("price_reference_id").notNull().references(() => priceReferences.id),
    value: numeric("value").notNull(),
    currency: text("currency").notNull().default("USD"),
    asOf: date("as_of", { mode: "string" }).notNull(),
    sourceUrl: text("source_url").notNull(),
    enteredByUserId: uuid("entered_by_user_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("nav_observations_latest_idx").on(t.priceReferenceId, t.asOf, t.createdAt)],
);

/** Append-only. */
export const assetEvents = app.table(
  "asset_events",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    entityType: assetEventEntity("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: assetEventKind("kind").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** Shown to the submitter. */
    message: text("message"),
    /** Ops only. */
    internalNote: text("internal_note"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("asset_events_instrument_idx").on(t.instrumentId, t.createdAt)],
);
