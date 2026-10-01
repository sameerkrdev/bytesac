import { sql } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { instruments } from "./assets";
import { baskets, basketStatus, basketVersions } from "./baskets";
import { app } from "./enums";
import { users } from "./identity";
import { organizations } from "./organizations";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const assetTagStatus = app.enum("asset_tag_status", ["active", "retired"]);
export const managerProfileStatus = app.enum("manager_profile_status", ["draft", "published", "hidden"]);
export const embeddingStatus = app.enum("embedding_status", ["pending", "ready", "failed"]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const assetTags = app.table(
  "asset_tags",
  {
    id: id(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    status: assetTagStatus("status").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    retiredAt: ts("retired_at"),
  },
  (t) => [
    check("asset_tags_key_format", sql`${t.key} ~ '^[a-z0-9-]{2,32}$'`),
    check("asset_tags_label_length", sql`char_length(${t.label}) between 1 and 40`),
  ],
);

export const instrumentTags = app.table(
  "instrument_tags",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    tagId: uuid("tag_id").notNull().references(() => assetTags.id),
    addedByUserId: uuid("added_by_user_id").notNull().references(() => users.id),
    addedAt: ts("added_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
  },
  (t) => [uniqueIndex("instrument_tags_one_live").on(t.instrumentId, t.tagId).where(sql`${t.removedAt} is null`)],
);

export const managerProfiles = app.table(
  "manager_profiles",
  {
    id: id(),
    userId: uuid("user_id").notNull().unique().references(() => users.id),
    handle: text("handle").notNull().unique(),
    displayName: text("display_name").notNull(),
    headline: text("headline"),
    bio: text("bio"),
    experienceYears: integer("experience_years"),
    background: text("background"),
    qualifications: text("qualifications").array().notNull().default(sql`'{}'::text[]`),
    /** `{ label, url }[]`, https only, at most 5. */
    links: jsonb("links").$type<Array<{ label: string; url: string }>>().notNull().default([]),
    status: managerProfileStatus("status").notNull().default("draft"),
    hiddenReason: text("hidden_reason"),
    hiddenByUserId: uuid("hidden_by_user_id").references(() => users.id),
    publishedAt: ts("published_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("manager_profiles_status_idx").on(t.status, t.updatedAt),
    check("manager_profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9-]{3,30}$'`),
    check("manager_profiles_display_name_length", sql`char_length(${t.displayName}) between 2 and 80`),
    check("manager_profiles_headline_length", sql`${t.headline} is null or char_length(${t.headline}) <= 120`),
    check("manager_profiles_bio_length", sql`${t.bio} is null or char_length(${t.bio}) <= 2000`),
    check("manager_profiles_background_length", sql`${t.background} is null or char_length(${t.background}) <= 2000`),
    check("manager_profiles_experience_range", sql`${t.experienceYears} is null or ${t.experienceYears} between 0 and 60`),
    check("manager_profiles_qualifications_count", sql`cardinality(${t.qualifications}) <= 10`),
    check("manager_profiles_links_count", sql`jsonb_array_length(${t.links}) <= 5`),
    check("manager_profiles_hidden_reason_length", sql`${t.hiddenReason} is null or char_length(${t.hiddenReason}) <= 500`),
  ],
);

export const instrumentPriceSnapshots = app.table(
  "instrument_price_snapshots",
  {
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    day: date("day", { mode: "string" }).notNull(),
    priceUsd: numeric("price_usd").notNull(),
    source: text("source").notNull().default("coinmarketcap"),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.day] }), check("instrument_price_snapshots_positive", sql`${t.priceUsd} > 0`)],
);

/** `holdings` = `{ gross, net, lastPrices, gapRun }` (decimal strings; the next day's step starts from it). */
export const basketPerformanceDays = app.table(
  "basket_performance_days",
  {
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    day: date("day", { mode: "string" }).notNull(),
    versionId: uuid("version_id").notNull().references(() => basketVersions.id),
    indexGross: numeric("index_gross").notNull(),
    indexNet: numeric("index_net").notNull(),
    gap: boolean("gap").notNull().default(false),
    holdings: jsonb("holdings").$type<{ gross: Record<string, string>; net: Record<string, string>; lastPrices: Record<string, string>; gapRun: Record<string, number> }>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.basketId, t.day] })],
);

export interface BasketMetrics {
  available: boolean;
  dataDays: number;
  net: { sinceLaunch: string | null; d30: string | null; d90: string | null; y1: string | null };
  gross: { sinceLaunch: string | null; d30: string | null; d90: string | null; y1: string | null };
  volatility: string | null;
  maxDrawdown: string | null;
}

/** Derived, updated in place; unlisted baskets keep their row with a non-listed `status` and are excluded by queries. */
export const basketSearchIndex = app.table(
  "basket_search_index",
  {
    basketId: uuid("basket_id").primaryKey().references(() => baskets.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    organizationName: text("organization_name").notNull(),
    slug: text("slug").notNull(),
    status: basketStatus("status").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    exposures: jsonb("exposures").$type<{
      instruments: Array<{ id: string; symbol: string; bps: number }>;
      assetTypes: Array<{ type: string; bps: number }>;
      sectors: Array<{ sector: string; bps: number }>;
    }>().notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    maxWeightBps: integer("max_weight_bps").notNull(),
    minimumInvestmentUsdc: numeric("minimum_investment_usdc").notNull(),
    feeEntryBps: integer("fee_entry_bps").notNull(),
    feeManagementBps: integer("fee_management_bps").notNull(),
    feeRebalanceBps: integer("fee_rebalance_bps").notNull(),
    feeSubscriptionBps: integer("fee_subscription_bps"),
    reviewFrequency: text("review_frequency").notNull(),
    publishedAt: ts("published_at").notNull(),
    currentVersionId: uuid("current_version_id").notNull().references(() => basketVersions.id),
    managerHandles: text("manager_handles").array().notNull().default(sql`'{}'::text[]`),
    managerMaxExperienceYears: integer("manager_max_experience_years"),
    metrics: jsonb("metrics").$type<BasketMetrics>().notNull(),
    searchText: tsvector("search_text").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingStatus: embeddingStatus("embedding_status").notNull().default("pending"),
    embeddingAttempts: integer("embedding_attempts").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("basket_search_index_search_text_idx").using("gin", t.searchText),
    index("basket_search_index_tags_idx").using("gin", t.tags),
    index("basket_search_index_listing_idx").on(t.status, t.publishedAt, t.basketId),
  ],
);
