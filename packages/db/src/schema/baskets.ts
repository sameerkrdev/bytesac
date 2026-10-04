import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { instruments } from "./assets";
import { app } from "./enums";
import { users } from "./identity";
import { organizationMemberships, organizations } from "./organizations";

export const basketStatus = app.enum("basket_status", ["DRAFT", "ACTIVE", "PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED", "REJECTED"]);
export const basketVersionStatus = app.enum("basket_version_status", ["draft", "in_review", "changes_required", "approved", "published", "superseded", "rejected"]);
export const basketCategory = app.enum("basket_category", ["index", "thematic", "sector", "yield", "stablecoin", "rwa", "multi_asset"]);
export const basketPauseKind = app.enum("basket_pause_kind", ["manager", "platform"]);
export const basketAssignmentRole = app.enum("basket_assignment_role", ["lead", "co_manager"]);
export const basketAssignmentStatus = app.enum("basket_assignment_status", ["PENDING_APPROVAL", "ACTIVE", "ENDED", "REJECTED"]);
export const basketReviewDecision = app.enum("basket_review_decision", ["changes_required", "rejected", "approved", "escalated"]);
export const disclosureCondition = app.enum("disclosure_condition", ["always", "has_stablecoin", "has_rwa"]);
export const disclosureTemplateStatus = app.enum("disclosure_template_status", ["active", "retired"]);
export const basketActor = app.enum("basket_actor", ["member", "ops", "system"]);
export const basketEventKind = app.enum("basket_event_kind", [
  "created", "draft_saved", "submitted", "withdrawn", "reviewed", "approved", "rejected", "published", "paused", "resumed", "retirement_requested", "retirement_decided", "retired",
  "assignment_added", "assignment_changed", "assignment_ended", "lead_decided", "reassignment_required", "disclosures_repinned",
]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const baskets = app.table(
  "baskets",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    slug: text("slug").notNull().unique(),
    status: basketStatus("status").notNull().default("DRAFT"),
    previousStatus: basketStatus("previous_status"),
    pauseKind: basketPauseKind("pause_kind"),
    pauseReason: text("pause_reason"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => basketVersions.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    /** Ops curation for the "Featured" rail: 1 shows first; null means not featured. Not a recommendation of suitability. */
    featuredRank: integer("featured_rank"),
    featuredAt: ts("featured_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("baskets_org_idx").on(t.organizationId, t.updatedAt),
    index("baskets_featured_idx").on(t.featuredRank).where(sql`${t.featuredRank} is not null`),
    check("baskets_featured_rank", sql`${t.featuredRank} is null or ${t.featuredRank} between 1 and 99`),
    check("baskets_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 90`),
  ],
);

export const basketSlugAliases = app.table("basket_slug_aliases", {
  slug: text("slug").primaryKey(),
  basketId: uuid("basket_id").notNull().references(() => baskets.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const basketVersions = app.table(
  "basket_versions",
  {
    id: id(),
    basketId: uuid("basket_id").notNull().references((): AnyPgColumn => baskets.id),
    versionNumber: integer("version_number").notNull(),
    status: basketVersionStatus("status").notNull().default("draft"),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    longDescription: text("long_description"),
    category: basketCategory("category").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    objective: text("objective"),
    thesis: text("thesis"),
    methodology: text("methodology"),
    intendedInvestor: text("intended_investor"),
    horizon: text("horizon"),
    keyAssumptions: text("key_assumptions"),
    knownLimitations: text("known_limitations"),
    strategyRisks: text("strategy_risks"),
    liquidityNotes: text("liquidity_notes"),
    conflictsOfInterest: text("conflicts_of_interest"),
    /** Shapes are the zod schemas in @repo/validator (basketConstraintsSchema, basketRebalanceSchema, basketFeesSchema). */
    constraints: jsonb("constraints").$type<Record<string, number>>().notNull().default({}),
    rebalance: jsonb("rebalance").$type<{ reviewFrequency: "none" | "monthly" | "quarterly"; driftThresholdBps?: number; minTradeBps?: number; minTradeUsdc?: string }>().notNull().default({ reviewFrequency: "none" }),
    fees: jsonb("fees").$type<Record<string, unknown>>().notNull(),
    /** Decimal string in JSON (numeric round-trips as text). */
    minimumInvestmentUsdc: numeric("minimum_investment_usdc"),
    minimumIncrementUsdc: numeric("minimum_increment_usdc"),
    rationale: text("rationale"),
    /** Replaceable child rows are revisioned (the runtime role cannot DELETE): reads use the rows whose `revision` equals these counters. */
    assetsRevision: integer("assets_revision").notNull().default(0),
    /** Incremented on every draft save: the optimistic-lock token of `expectedRevision` (replaces the millisecond `updated_at` compare). */
    revision: integer("revision").notNull().default(0),
    disclosuresRevision: integer("disclosures_revision").notNull().default(0),
    contentHash: text("content_hash"),
    approvedHash: text("approved_hash"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id),
    submittedAt: ts("submitted_at"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: ts("approved_at"),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id),
    publishedAt: ts("published_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("basket_versions_number").on(t.basketId, t.versionNumber),
    uniqueIndex("basket_versions_one_open").on(t.basketId).where(sql`${t.status} in ('draft', 'in_review', 'changes_required', 'approved')`),
    index("basket_versions_review_idx").on(t.status, t.updatedAt),
  ],
);

export const basketVersionAssets = app.table(
  "basket_version_assets",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => basketVersions.id),
    revision: integer("revision").notNull(),
    instrumentId: uuid("instrument_id").notNull().references(() => instruments.id),
    targetWeightBps: integer("target_weight_bps").notNull(),
    minWeightBps: integer("min_weight_bps"),
    maxWeightBps: integer("max_weight_bps"),
    rationale: text("rationale"),
  },
  (t) => [uniqueIndex("basket_version_assets_unique").on(t.versionId, t.revision, t.instrumentId)],
);

export const disclosureTemplates = app.table(
  "disclosure_templates",
  {
    id: id(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    condition: disclosureCondition("condition").notNull(),
    status: disclosureTemplateStatus("status").notNull().default("active"),
    /** Null for the seeded rows. */
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    retiredAt: ts("retired_at"),
  },
  (t) => [
    uniqueIndex("disclosure_templates_key_version").on(t.key, t.version),
    uniqueIndex("disclosure_templates_one_active").on(t.key).where(sql`${t.status} = 'active'`),
    check("disclosure_templates_key_format", sql`${t.key} ~ '^[a-z_]{3,60}$'`),
  ],
);

export const basketVersionDisclosures = app.table(
  "basket_version_disclosures",
  {
    versionId: uuid("version_id").notNull().references(() => basketVersions.id),
    revision: integer("revision").notNull(),
    templateId: uuid("template_id").notNull().references(() => disclosureTemplates.id),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.revision, t.templateId] })],
);

const ASSIGNMENT_FLAG_LIST = sql`array['edit', 'submit', 'publish', 'lifecycle', 'assign']::text[]`;

export const basketAssignments = app.table(
  "basket_assignments",
  {
    id: id(),
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    membershipId: uuid("membership_id").notNull().references(() => organizationMemberships.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: basketAssignmentRole("role").notNull(),
    /** Subset of edit, submit, publish, lifecycle, assign (ASSIGNMENT_FLAGS in @repo/validator). */
    permissions: text("permissions").array().notNull(),
    status: basketAssignmentStatus("status").notNull(),
    assignedByUserId: uuid("assigned_by_user_id").notNull().references(() => users.id),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    endReason: text("end_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("basket_assignments_one_open_per_user").on(t.basketId, t.userId).where(sql`${t.status} in ('ACTIVE', 'PENDING_APPROVAL')`),
    // One ACTIVE lead and, separately, one PENDING_APPROVAL lead (a replacement waits while the current lead stays).
    uniqueIndex("basket_assignments_one_active_lead").on(t.basketId).where(sql`${t.role} = 'lead' and ${t.status} = 'ACTIVE'`),
    uniqueIndex("basket_assignments_one_pending_lead").on(t.basketId).where(sql`${t.role} = 'lead' and ${t.status} = 'PENDING_APPROVAL'`),
    index("basket_assignments_membership_idx").on(t.membershipId),
    check("basket_assignments_flags", sql`${t.permissions} <@ ${ASSIGNMENT_FLAG_LIST}`),
    check("basket_assignments_lead_all_flags", sql`${t.role} <> 'lead' or ${t.permissions} @> ${ASSIGNMENT_FLAG_LIST}`),
  ],
);

export const basketReviews = app.table(
  "basket_reviews",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => basketVersions.id),
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id),
    decision: basketReviewDecision("decision").notNull(),
    /** `{ completeness, assets, allocation, communication, managers, fees, operations }`, each `{ result: pass | fail | na, note? }`. */
    checklist: jsonb("checklist").$type<Record<string, { result: "pass" | "fail" | "na"; note?: string }>>().notNull(),
    sectionComments: jsonb("section_comments").$type<Array<{ section: string; comment: string }>>().notNull().default([]),
    messageToManager: text("message_to_manager"),
    /** Ops only: never selected into a manager or public view. */
    internalNote: text("internal_note"),
    reviewedHash: text("reviewed_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("basket_reviews_version_idx").on(t.versionId, t.createdAt)],
);

/** Append-only. */
export const basketEvents = app.table(
  "basket_events",
  {
    id: id(),
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    versionId: uuid("version_id").references(() => basketVersions.id),
    assignmentId: uuid("assignment_id").references(() => basketAssignments.id),
    kind: basketEventKind("kind").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorType: basketActor("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("basket_events_basket_idx").on(t.basketId, t.createdAt)],
);
