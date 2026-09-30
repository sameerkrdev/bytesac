import { z } from "zod";
import { assetTypeSchema, instrumentStatusSchema } from "./assets";

// ---------------------------------------------------------------------------------------------------------------------
// Enums and lifecycle
// ---------------------------------------------------------------------------------------------------------------------

export const BASKET_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED", "REJECTED"] as const;
export const basketStatusSchema = z.enum(BASKET_STATUSES);
export type BasketStatus = z.infer<typeof basketStatusSchema>;

export const BASKET_VERSION_STATUSES = ["draft", "in_review", "changes_required", "approved", "published", "superseded", "rejected"] as const;
export const basketVersionStatusSchema = z.enum(BASKET_VERSION_STATUSES);
export type BasketVersionStatus = z.infer<typeof basketVersionStatusSchema>;

export const basketCategorySchema = z.enum(["index", "thematic", "sector", "yield", "stablecoin", "rwa", "multi_asset"]);
export type BasketCategory = z.infer<typeof basketCategorySchema>;

export const basketPauseKindSchema = z.enum(["manager", "platform"]);
export const basketAssignmentRoleSchema = z.enum(["lead", "co_manager"]);
export const basketAssignmentStatusSchema = z.enum(["PENDING_APPROVAL", "ACTIVE", "ENDED", "REJECTED"]);
export const basketReviewDecisionSchema = z.enum(["changes_required", "rejected", "approved", "escalated"]);
export const disclosureConditionSchema = z.enum(["always", "has_stablecoin", "has_rwa"]);

export const ASSIGNMENT_FLAGS = ["edit", "submit", "publish", "lifecycle", "assign"] as const;
export const assignmentFlagSchema = z.enum(ASSIGNMENT_FLAGS);
export type AssignmentFlag = z.infer<typeof assignmentFlagSchema>;
export const LEAD_FLAGS: readonly AssignmentFlag[] = ASSIGNMENT_FLAGS;
export const CO_MANAGER_DEFAULT_FLAGS: readonly AssignmentFlag[] = ["edit", "submit"];

export const BASKET_TRANSITIONS: Readonly<Record<BasketStatus, readonly BasketStatus[]>> = {
  DRAFT: ["ACTIVE", "REJECTED"],
  ACTIVE: ["PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED"],
  PAUSED: ["ACTIVE", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING", "RETIRED"],
  REASSIGNMENT_REQUIRED: ["ACTIVE", "PAUSED", "RETIRED"],
  RETIREMENT_PENDING: ["ACTIVE", "PAUSED", "RETIRED"],
  RETIRED: [],
  REJECTED: [],
};
export const BASKET_VERSION_TRANSITIONS: Readonly<Record<BasketVersionStatus, readonly BasketVersionStatus[]>> = {
  draft: ["in_review"],
  in_review: ["draft", "changes_required", "approved", "rejected"],
  changes_required: ["in_review"],
  approved: ["published"],
  published: ["superseded"],
  superseded: [],
  rejected: [],
};

// ---------------------------------------------------------------------------------------------------------------------
// Content shapes (money is a decimal string or integer bps, never a JS number)
// ---------------------------------------------------------------------------------------------------------------------

/** USDC has 6 decimals. */
export const decimalStringSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);

export const feeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("percent"), bps: z.number().int().min(0).max(100) }),
  z.strictObject({ type: z.literal("fixed"), amountUsdc: decimalStringSchema }),
]);
export type Fee = z.infer<typeof feeSchema>;

export const basketFeesSchema = z.strictObject({
  entry: feeSchema,
  management: feeSchema,
  rebalance: feeSchema,
  subscription: z.strictObject({ amountUsdc: decimalStringSchema, period: z.enum(["monthly", "yearly"]) }).nullable(),
});
export type BasketFees = z.infer<typeof basketFeesSchema>;

export const basketConstraintsSchema = z.strictObject({
  maxWeightPerAssetBps: z.number().int().min(100).max(10_000).optional(),
  maxStablecoinBps: z.number().int().min(0).max(10_000).optional(),
  maxRwaBps: z.number().int().min(0).max(10_000).optional(),
});
export type BasketConstraints = z.infer<typeof basketConstraintsSchema>;

export const basketRebalanceSchema = z.strictObject({
  reviewFrequency: z.enum(["none", "monthly", "quarterly"]),
  driftThresholdBps: z.number().int().min(50).max(5000).optional(),
});
export type BasketRebalance = z.infer<typeof basketRebalanceSchema>;

/** Weights are accepted as sent (whole bps only); the platform rules are reported by `validateBasketVersion`, never applied silently. */
export const basketAssetInputSchema = z.strictObject({
  instrumentId: z.uuid(),
  targetWeightBps: z.number().int().min(0).max(10_000),
  minWeightBps: z.number().int().min(0).max(10_000).nullable().optional(),
  maxWeightBps: z.number().int().min(0).max(10_000).nullable().optional(),
  rationale: z.string().trim().max(500).nullable().optional(),
});
export type BasketAssetInput = z.infer<typeof basketAssetInputSchema>;

const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const createBasketRequestSchema = z.strictObject({ name: z.string().trim().min(3).max(80), category: basketCategorySchema });
export type CreateBasketRequest = z.infer<typeof createBasketRequestSchema>;

/** Omitted = unchanged, `null` = clear. `expectedUpdatedAt` is the `updatedAt` of the version as the client last saw it. */
export const saveBasketDraftRequestSchema = z.strictObject({
  name: z.string().trim().min(3).max(80).optional(),
  shortDescription: z.string().trim().min(1).max(160).nullable().optional(),
  longDescription: text(5000),
  category: basketCategorySchema.optional(),
  tags: z.array(z.string().regex(/^[a-z0-9-]{1,24}$/)).max(5).optional(),
  objective: text(2000),
  thesis: text(5000),
  methodology: text(5000),
  intendedInvestor: text(1000),
  horizon: text(200),
  keyAssumptions: text(2000),
  knownLimitations: text(2000),
  strategyRisks: text(5000),
  liquidityNotes: text(2000),
  conflictsOfInterest: text(2000),
  constraints: basketConstraintsSchema.optional(),
  rebalance: basketRebalanceSchema.optional(),
  fees: basketFeesSchema.optional(),
  minimumInvestmentUsdc: decimalStringSchema.nullable().optional(),
  minimumIncrementUsdc: decimalStringSchema.nullable().optional(),
  rationale: text(2000),
  /** A duplicate is refused here (the unique row per instrument could not store it); ALLOCATION_DUPLICATE still guards the pure validator. */
  assets: z.array(basketAssetInputSchema).max(50).refine((a) => new Set(a.map((x) => x.instrumentId)).size === a.length, "Each asset can appear only once.").optional(),
  expectedUpdatedAt: z.iso.datetime(),
});
export type SaveBasketDraftRequest = z.infer<typeof saveBasketDraftRequestSchema>;

export const listBasketsQuerySchema = z.strictObject({ status: basketStatusSchema.optional() });
export type ListBasketsQuery = z.infer<typeof listBasketsQuerySchema>;

const flagsSchema = z.array(assignmentFlagSchema).min(1).refine((f) => new Set(f).size === f.length, "Flags must be unique");
export const createAssignmentRequestSchema = z.strictObject({ membershipId: z.uuid(), role: basketAssignmentRoleSchema, permissions: flagsSchema.optional() });
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;
export const updateAssignmentRequestSchema = z.strictObject({ permissions: flagsSchema });
export type UpdateAssignmentRequest = z.infer<typeof updateAssignmentRequestSchema>;
export const endAssignmentRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type EndAssignmentRequest = z.infer<typeof endAssignmentRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Validation (pure: the API loads the input, the web mirrors it for live feedback)
// ---------------------------------------------------------------------------------------------------------------------

export const BASKET_ISSUE_CODES = [
  "ORG_NOT_ELIGIBLE", "BASKET_NAME_REQUIRED", "DISCLOSURE_MISSING", "ASSET_UNSUPPORTED", "ASSET_COUNT_INVALID", "ALLOCATION_DUPLICATE", "ALLOCATION_WEIGHT_INVALID",
  "ALLOCATION_TOTAL_INVALID", "CONSTRAINT_VIOLATION", "FEE_CONFIGURATION_INVALID", "MINIMUM_INVESTMENT_INVALID", "MANAGER_ASSIGNMENT_REQUIRED", "REBALANCE_RATIONALE_REQUIRED",
] as const;
export const basketIssueCodeSchema = z.enum(BASKET_ISSUE_CODES);
export type BasketIssueCode = z.infer<typeof basketIssueCodeSchema>;
export const BASKET_SECTIONS = ["basics", "thesis", "assets", "constraints", "rebalance", "managers", "fees", "risks", "review"] as const;
export const basketSectionSchema = z.enum(BASKET_SECTIONS);
export type BasketSection = z.infer<typeof basketSectionSchema>;
export const basketIssueSchema = z.object({ code: basketIssueCodeSchema, section: basketSectionSchema, field: z.string().optional(), message: z.string() });
export type BasketIssue = z.infer<typeof basketIssueSchema>;
export const basketValidationSchema = z.object({ issues: z.array(basketIssueSchema), warnings: z.array(basketIssueSchema) });
export type BasketValidation = z.infer<typeof basketValidationSchema>;

export interface BasketValidationInput {
  version: {
    name: string | null; shortDescription: string | null; strategyRisks: string | null; thesis: string | null; methodology: string | null; rationale: string | null;
    constraints: BasketConstraints; fees: BasketFees; minimumInvestmentUsdc: string | null; minimumIncrementUsdc: string | null;
  };
  assets: {
    instrumentId: string; targetWeightBps: number; minWeightBps: number | null; maxWeightBps: number | null;
    instrument: { status: z.infer<typeof instrumentStatusSchema>; assetType: z.infer<typeof assetTypeSchema>; hasActiveDeployment: boolean };
  }[];
  versionNumber: number;
  hasActiveLead: boolean;
  orgVerified: boolean;
}

const micro = (d: string): bigint => {
  const [i = "0", f = ""] = d.split(".");
  return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0"));
};
/** Fixed fee rule: amount ≤ 1% of the minimum investment, compared exactly in micro-USDC. */
export const feeWithinCap = (amountUsdc: string, minimumUsdc: string): boolean => micro(amountUsdc) * 100n <= micro(minimumUsdc);
/** The largest allowed fixed fee for a minimum investment: 1% of it, rounded down to a whole micro-USDC (for display). */
export const maxFixedFeeUsdc = (minimumUsdc: string): string => {
  const cap = micro(minimumUsdc) / 100n;
  return `${cap / 1_000_000n}.${String(cap % 1_000_000n).padStart(6, "0")}`.replace(/\.?0+$/, "");
};

export function validateBasketVersion(i: BasketValidationInput): { issues: BasketIssue[]; warnings: BasketIssue[] } {
  const issues: BasketIssue[] = [];
  const warnings: BasketIssue[] = [];
  const add = (list: BasketIssue[], code: BasketIssueCode, section: BasketSection, message: string, field?: string) => list.push({ code, section, field, message });
  const v = i.version;
  if (!i.orgVerified) add(issues, "ORG_NOT_ELIGIBLE", "basics", "Your organization must be verified.");
  if (!v.name?.trim() || !v.shortDescription?.trim()) add(issues, "BASKET_NAME_REQUIRED", "basics", "Add a name and a short description.");
  if (!v.strategyRisks?.trim()) add(issues, "DISCLOSURE_MISSING", "risks", "Describe the strategy's risks.", "strategyRisks");
  if (i.assets.length < 1 || i.assets.length > 20) add(issues, "ASSET_COUNT_INVALID", "assets", "Choose between 1 and 20 assets.");
  const seen = new Set<string>();
  let total = 0, stable = 0, rwa = 0;
  for (const a of i.assets) {
    if (seen.has(a.instrumentId)) add(issues, "ALLOCATION_DUPLICATE", "assets", "Each asset can appear only once.", a.instrumentId);
    seen.add(a.instrumentId);
    if (a.instrument.status !== "ACTIVE" || !a.instrument.hasActiveDeployment) add(issues, "ASSET_UNSUPPORTED", "assets", "This asset is not available for baskets.", a.instrumentId);
    if (a.instrument.status === "PAUSED" || a.instrument.status === "DEPRECATED") add(warnings, "ASSET_UNSUPPORTED", "assets", "This asset is paused or deprecated in the registry.", a.instrumentId);
    const w = a.targetWeightBps;
    const bandOk = (a.minWeightBps ?? 0) <= w && w <= (a.maxWeightBps ?? 10_000);
    if (!Number.isInteger(w) || w < 100 || !bandOk) add(issues, "ALLOCATION_WEIGHT_INVALID", "assets", "Each weight must be a whole number of at least 1% and inside its band.", a.instrumentId);
    if (w > 5000) add(warnings, "CONSTRAINT_VIOLATION", "assets", "One asset is more than half of the basket.", a.instrumentId);
    if (v.constraints.maxWeightPerAssetBps !== undefined && w > v.constraints.maxWeightPerAssetBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "An asset is above the maximum weight per asset.", a.instrumentId);
    total += w;
    if (a.instrument.assetType === "STABLECOIN") stable += w;
    if (a.instrument.assetType.startsWith("TOKENIZED_")) rwa += w;
  }
  if (total !== 10_000) add(issues, "ALLOCATION_TOTAL_INVALID", "assets", `Weights add up to ${total / 100}%; they must add up to 100%.`);
  if (v.constraints.maxStablecoinBps !== undefined && stable > v.constraints.maxStablecoinBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "Stablecoins are above the stablecoin cap.");
  if (v.constraints.maxRwaBps !== undefined && rwa > v.constraints.maxRwaBps) add(issues, "CONSTRAINT_VIOLATION", "constraints", "Tokenized assets are above the RWA cap.");
  const min = v.minimumInvestmentUsdc;
  if (!min || micro(min) <= 0n) add(issues, "MINIMUM_INVESTMENT_INVALID", "fees", "Set a minimum investment above zero.", "minimumInvestmentUsdc");
  else {
    if (v.minimumIncrementUsdc && (micro(v.minimumIncrementUsdc) <= 0n || micro(v.minimumIncrementUsdc) > micro(min))) add(issues, "MINIMUM_INVESTMENT_INVALID", "fees", "The increment must be above zero and not above the minimum.", "minimumIncrementUsdc");
    const fixed = [v.fees.entry, v.fees.management, v.fees.rebalance].flatMap((f) => (f.type === "fixed" ? [f.amountUsdc] : []));
    if (v.fees.subscription) fixed.push(v.fees.subscription.amountUsdc);
    if (fixed.some((amount) => !feeWithinCap(amount, min))) add(issues, "FEE_CONFIGURATION_INVALID", "fees", "A fixed fee can't be more than 1% of the minimum investment.");
  }
  if ([v.fees.entry, v.fees.management, v.fees.rebalance].some((f) => f.type === "percent" && (f.bps < 0 || f.bps > 100))) add(issues, "FEE_CONFIGURATION_INVALID", "fees", "A percentage fee can't be more than 1%.");
  if (!i.hasActiveLead) add(issues, "MANAGER_ASSIGNMENT_REQUIRED", "managers", "Assign a lead manager.");
  if (i.versionNumber >= 2 && !v.rationale?.trim()) add(issues, "REBALANCE_RATIONALE_REQUIRED", "review", "Explain why this version changes the basket.", "rationale");
  if (!v.thesis?.trim() || !v.methodology?.trim()) add(warnings, "BASKET_NAME_REQUIRED", "thesis", "Investors understand a basket better with a thesis and methodology.");
  return { issues, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Canonical JSON and diff
// ---------------------------------------------------------------------------------------------------------------------

/** JSON with object keys sorted at every depth, so equal content always serializes (and hashes) the same. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

export interface BasketDiffInput {
  version: Pick<BasketValidationInput["version"], "constraints" | "fees" | "minimumInvestmentUsdc" | "minimumIncrementUsdc"> & { rebalance: BasketRebalance };
  assets: { instrumentId: string; targetWeightBps: number; minWeightBps: number | null; maxWeightBps: number | null }[];
}

export const basketDiffSchema = z.object({
  added: z.array(z.object({ instrumentId: z.string(), weightBps: z.number() })),
  removed: z.array(z.object({ instrumentId: z.string(), weightBps: z.number() })),
  changed: z.array(z.object({ instrumentId: z.string(), fromBps: z.number(), toBps: z.number() })),
  bandChanged: z.array(z.string()),
  constraints: z.boolean(),
  rebalance: z.boolean(),
  fees: z.boolean(),
  minimums: z.boolean(),
});
export type BasketDiff = z.infer<typeof basketDiffSchema>;

/** What changed from `prev` to `next`; with no previous version everything is added. */
export function diffBasketVersions(prev: BasketDiffInput | null, next: BasketDiffInput): BasketDiff {
  const before = new Map((prev?.assets ?? []).map((a) => [a.instrumentId, a]));
  const after = new Map(next.assets.map((a) => [a.instrumentId, a]));
  const changed = next.assets.filter((a) => before.has(a.instrumentId) && before.get(a.instrumentId)!.targetWeightBps !== a.targetWeightBps);
  const differs = (a: unknown, b: unknown) => canonicalJson(a) !== canonicalJson(b);
  return {
    added: next.assets.filter((a) => !before.has(a.instrumentId)).map((a) => ({ instrumentId: a.instrumentId, weightBps: a.targetWeightBps })),
    removed: [...before.values()].filter((a) => !after.has(a.instrumentId)).map((a) => ({ instrumentId: a.instrumentId, weightBps: a.targetWeightBps })),
    changed: changed.map((a) => ({ instrumentId: a.instrumentId, fromBps: before.get(a.instrumentId)!.targetWeightBps, toBps: a.targetWeightBps })),
    bandChanged: next.assets.filter((a) => {
      const p = before.get(a.instrumentId);
      return p !== undefined && (p.minWeightBps !== a.minWeightBps || p.maxWeightBps !== a.maxWeightBps);
    }).map((a) => a.instrumentId),
    constraints: prev !== null && differs(prev.version.constraints, next.version.constraints),
    rebalance: prev !== null && differs(prev.version.rebalance, next.version.rebalance),
    fees: prev !== null && differs(prev.version.fees, next.version.fees),
    minimums: prev !== null && (prev.version.minimumInvestmentUsdc !== next.version.minimumInvestmentUsdc || prev.version.minimumIncrementUsdc !== next.version.minimumIncrementUsdc),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------------

const iso = z.string();
export const basketAssetViewSchema = z.object({
  instrumentId: z.string(), name: z.string(), symbol: z.string(), assetType: assetTypeSchema, instrumentStatus: instrumentStatusSchema, hasActiveDeployment: z.boolean(),
  targetWeightBps: z.number(), minWeightBps: z.number().nullable(), maxWeightBps: z.number().nullable(), rationale: z.string().nullable(),
});
export type BasketAssetView = z.infer<typeof basketAssetViewSchema>;

export const basketVersionViewSchema = z.object({
  id: z.string(), versionNumber: z.number(), status: basketVersionStatusSchema, name: z.string(), shortDescription: z.string().nullable(), longDescription: z.string().nullable(),
  category: basketCategorySchema, tags: z.array(z.string()), objective: z.string().nullable(), thesis: z.string().nullable(), methodology: z.string().nullable(),
  intendedInvestor: z.string().nullable(), horizon: z.string().nullable(), keyAssumptions: z.string().nullable(), knownLimitations: z.string().nullable(),
  strategyRisks: z.string().nullable(), liquidityNotes: z.string().nullable(), conflictsOfInterest: z.string().nullable(),
  constraints: basketConstraintsSchema, rebalance: basketRebalanceSchema, fees: basketFeesSchema, minimumInvestmentUsdc: z.string().nullable(), minimumIncrementUsdc: z.string().nullable(),
  rationale: z.string().nullable(), contentHash: z.string().nullable(), submittedAt: iso.nullable(), approvedAt: iso.nullable(), publishedAt: iso.nullable(),
  createdAt: iso, updatedAt: iso,
  assets: z.array(basketAssetViewSchema),
  disclosures: z.array(z.object({ templateId: z.string(), key: z.string(), title: z.string(), body: z.string() })),
});
export type BasketVersionView = z.infer<typeof basketVersionViewSchema>;

export const basketAssignmentViewSchema = z.object({
  id: z.string(), membershipId: z.string(), displayName: z.string().nullable(), role: basketAssignmentRoleSchema, permissions: z.array(assignmentFlagSchema),
  status: basketAssignmentStatusSchema, startedAt: iso.nullable(), endedAt: iso.nullable(), endReason: z.string().nullable(), isSelf: z.boolean(),
});
export type BasketAssignmentView = z.infer<typeof basketAssignmentViewSchema>;

/** The manager-facing part of a review: the internal note is never included. */
export const basketReviewViewSchema = z.object({
  id: z.string(), versionId: z.string(), decision: basketReviewDecisionSchema, checklist: z.unknown(), sectionComments: z.array(z.object({ section: z.string(), comment: z.string() })),
  messageToManager: z.string().nullable(), createdAt: iso,
});
export type BasketReviewView = z.infer<typeof basketReviewViewSchema>;

export const basketEventViewSchema = z.object({
  id: z.string(), kind: z.string(), versionId: z.string().nullable(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), actorType: z.string(), reason: z.string().nullable(), createdAt: iso,
});

export type BasketEventView = z.infer<typeof basketEventViewSchema>;

export const basketSummarySchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), category: basketCategorySchema, status: basketStatusSchema, currentVersionNumber: z.number().nullable(),
  openVersionStatus: basketVersionStatusSchema.nullable(), updatedAt: iso,
});
export type BasketSummary = z.infer<typeof basketSummarySchema>;
export const listBasketsResponseSchema = z.object({ baskets: z.array(basketSummarySchema) });
export type ListBasketsResponse = z.infer<typeof listBasketsResponseSchema>;

export const basketDetailSchema = z.object({
  id: z.string(), organizationId: z.string(), slug: z.string(), status: basketStatusSchema, previousStatus: basketStatusSchema.nullable(), pauseKind: basketPauseKindSchema.nullable(),
  pauseReason: z.string().nullable(), createdAt: iso, updatedAt: iso,
  /** The flags the caller holds on this basket (all five for OWNER/ADMIN, none for a read-only member). */
  myPermissions: z.array(assignmentFlagSchema),
  /** True for OWNER/ADMIN and the current ACTIVE lead: the only ones who may add, replace or end a lead (ADR-011). */
  canControlLead: z.boolean(),
  openVersion: basketVersionViewSchema.nullable(),
  publishedVersion: basketVersionViewSchema.nullable(),
  assignments: z.array(basketAssignmentViewSchema),
  reviews: z.array(basketReviewViewSchema),
  events: z.array(basketEventViewSchema),
  validation: basketValidationSchema.nullable(),
  hasAssetWarning: z.boolean(),
});
export type BasketDetail = z.infer<typeof basketDetailSchema>;

export const basketVersionSummarySchema = z.object({ id: z.string(), versionNumber: z.number(), status: basketVersionStatusSchema, name: z.string(), rationale: z.string().nullable(), publishedAt: iso.nullable(), createdAt: iso });
export const listBasketVersionsResponseSchema = z.object({ versions: z.array(basketVersionSummarySchema) });
export type ListBasketVersionsResponse = z.infer<typeof listBasketVersionsResponseSchema>;

/** A public-shaped rendering of the open version, labelled as a preview by the client. */
export const basketPreviewSchema = z.object({ version: basketVersionViewSchema, validation: basketValidationSchema });
export type BasketPreview = z.infer<typeof basketPreviewSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Lifecycle, review and ops
// ---------------------------------------------------------------------------------------------------------------------

export const basketReasonRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type BasketReasonRequest = z.infer<typeof basketReasonRequestSchema>;

/** Lead approval and the retirement decision. */
export const basketApprovalRequestSchema = z.strictObject({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().max(500).optional() });
export type BasketApprovalRequest = z.infer<typeof basketApprovalRequestSchema>;

export const REVIEW_CHECKLIST_KEYS = ["completeness", "assets", "allocation", "communication", "managers", "fees", "operations"] as const;
const checklistItemSchema = z.strictObject({ result: z.enum(["pass", "fail", "na"]), note: z.string().trim().max(500).optional() });
export const basketReviewDecisionRequestSchema = z.strictObject({
  decision: basketReviewDecisionSchema,
  checklist: z.strictObject(Object.fromEntries(REVIEW_CHECKLIST_KEYS.map((k) => [k, checklistItemSchema])) as Record<(typeof REVIEW_CHECKLIST_KEYS)[number], typeof checklistItemSchema>),
  sectionComments: z.array(z.strictObject({ section: basketSectionSchema, comment: z.string().trim().min(1).max(1000) })).max(30).optional(),
  messageToManager: z.string().trim().max(2000).optional(),
  internalNote: z.string().trim().max(2000).optional(),
}).superRefine((v, ctx) => {
  if ((v.decision === "changes_required" || v.decision === "rejected") && !v.messageToManager) ctx.addIssue({ code: "custom", path: ["messageToManager"], message: "Tell the manager what to change." });
  if (v.decision === "escalated" && !v.internalNote) ctx.addIssue({ code: "custom", path: ["internalNote"], message: "Add an internal note for the escalation." });
});
export type BasketReviewDecisionRequest = z.infer<typeof basketReviewDecisionRequestSchema>;

export const listOpsBasketsQuerySchema = z.strictObject({ queue: z.enum(["review", "escalated", "leads", "retirements"]).default("review"), cursor: z.string().max(200).optional() });
export type ListOpsBasketsQuery = z.infer<typeof listOpsBasketsQuerySchema>;

export const opsBasketSummarySchema = z.object({
  id: z.string(), name: z.string(), organizationId: z.string(), organizationName: z.string().nullable(), status: basketStatusSchema,
  latestVersionNumber: z.number(), latestVersionStatus: basketVersionStatusSchema, updatedAt: iso,
});
export const opsBasketListResponseSchema = z.object({ items: z.array(opsBasketSummarySchema), nextCursor: z.string().nullable() });
export type OpsBasketListResponse = z.infer<typeof opsBasketListResponseSchema>;

export const opsBasketDetailSchema = basketDetailSchema.omit({ myPermissions: true, canControlLead: true, reviews: true }).extend({
  organization: z.object({ id: z.string(), displayName: z.string().nullable(), status: z.string() }),
  versions: z.array(basketVersionSummarySchema),
  /** Every review with the internal note, for ops only. */
  reviews: z.array(basketReviewViewSchema.extend({ reviewerUserId: z.string(), internalNote: z.string().nullable(), reviewedHash: z.string() })),
  diff: basketDiffSchema.nullable(),
});
export type OpsBasketDetail = z.infer<typeof opsBasketDetailSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Disclosure templates
// ---------------------------------------------------------------------------------------------------------------------

export const createDisclosureTemplateRequestSchema = z.strictObject({
  key: z.string().regex(/^[a-z_]{3,60}$/), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(5000), condition: disclosureConditionSchema,
});
export type CreateDisclosureTemplateRequest = z.infer<typeof createDisclosureTemplateRequestSchema>;
export const disclosureTemplateViewSchema = z.object({
  id: z.string(), key: z.string(), version: z.number(), title: z.string(), body: z.string(), condition: disclosureConditionSchema, status: z.enum(["active", "retired"]), createdAt: iso, retiredAt: iso.nullable(),
});
export type DisclosureTemplateView = z.infer<typeof disclosureTemplateViewSchema>;
export const listDisclosureTemplatesResponseSchema = z.object({ groups: z.array(z.object({ key: z.string(), templates: z.array(disclosureTemplateViewSchema) })) });
export type ListDisclosureTemplatesResponse = z.infer<typeof listDisclosureTemplatesResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Public (no session): published content only, never ids of users or memberships, reviews or emails
// ---------------------------------------------------------------------------------------------------------------------

export const publicBasketQuerySchema = z.strictObject({ cursor: z.string().max(200).optional() });
export const publicBasketCardSchema = z.object({
  slug: z.string(), name: z.string(), shortDescription: z.string().nullable(), organizationName: z.string().nullable(), category: basketCategorySchema, assetCount: z.number(),
  minimumInvestmentUsdc: z.string().nullable(), status: basketStatusSchema, publishedAt: iso,
});
export const publicBasketListResponseSchema = z.object({ items: z.array(publicBasketCardSchema), nextCursor: z.string().nullable() });
export type PublicBasketListResponse = z.infer<typeof publicBasketListResponseSchema>;

const publicPriceSchema = z.object({
  instrumentId: z.string(), kind: z.enum(["market", "nav"]), status: z.enum(["ok", "unavailable"]), value: z.string().nullable(), currency: z.string(), source: z.string(), observedAt: z.string().nullable(), stale: z.boolean(),
});
export const publicBasketDetailSchema = z.object({
  slug: z.string(), status: basketStatusSchema, hasAssetWarning: z.boolean(),
  organization: z.object({ id: z.string(), displayName: z.string().nullable() }),
  version: z.object({
    versionNumber: z.number(), publishedAt: iso, name: z.string(), shortDescription: z.string().nullable(), longDescription: z.string().nullable(), category: basketCategorySchema, tags: z.array(z.string()),
    objective: z.string().nullable(), thesis: z.string().nullable(), methodology: z.string().nullable(), intendedInvestor: z.string().nullable(), horizon: z.string().nullable(),
    keyAssumptions: z.string().nullable(), knownLimitations: z.string().nullable(), strategyRisks: z.string().nullable(), liquidityNotes: z.string().nullable(), conflictsOfInterest: z.string().nullable(),
    constraints: basketConstraintsSchema, rebalance: basketRebalanceSchema, fees: basketFeesSchema, minimumInvestmentUsdc: z.string().nullable(), minimumIncrementUsdc: z.string().nullable(),
  }),
  allocation: z.array(z.object({
    instrumentId: z.string(), name: z.string(), symbol: z.string(), assetType: assetTypeSchema, chains: z.array(z.string()), targetWeightBps: z.number(),
    minWeightBps: z.number().nullable(), maxWeightBps: z.number().nullable(), prices: z.array(publicPriceSchema),
  })),
  disclosures: z.array(z.object({ title: z.string(), body: z.string() })),
  versionHistory: z.array(z.object({ versionNumber: z.number(), publishedAt: iso, rationale: z.string().nullable(), diff: basketDiffSchema })),
  managers: z.array(z.object({ displayName: z.string(), role: basketAssignmentRoleSchema, from: iso, to: iso.nullable() })),
});
export type PublicBasketDetail = z.infer<typeof publicBasketDetailSchema>;
export const publicBasketResponseSchema = z.union([publicBasketDetailSchema, z.object({ redirectTo: z.string() })]);
export type PublicBasketResponse = z.infer<typeof publicBasketResponseSchema>;
