import { z } from "zod";
import { assetTypeSchema, instrumentSectorSchema } from "./assets";
import { basketCategorySchema, basketStatusSchema, decimalStringSchema, micro, type Fee } from "./baskets";


const bps = z.number().int().min(0).max(10_000);
/** Fractions such as `0.12` (12%) or `-0.3`. */
const fractionSchema = z.string().regex(/^-?\d{1,3}(\.\d{1,6})?$/);
const range = { minBps: bps.optional(), maxBps: bps.optional() };

export const DISCOVERY_SORTS = ["relevance", "newest", "return_1y", "return_since_launch", "minimum_asc", "management_fee_asc"] as const;
export const discoverySortSchema = z.enum(DISCOVERY_SORTS);
export type DiscoverySort = z.infer<typeof discoverySortSchema>;

/** Shared by URL params, the manual filter UI and the Gemini tool. Unknown keys are dropped. */
export const discoveryFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  organizationId: z.uuid().optional(),
  managerHandle: z.string().regex(/^[a-z0-9-]{3,30}$/).optional(),
  categories: z.array(basketCategorySchema).max(10).optional(),
  assets: z.array(z.object({ instrumentId: z.uuid().optional(), symbol: z.string().trim().toUpperCase().min(1).max(20).optional(), ...range })
    .refine((a) => a.instrumentId || a.symbol, "instrumentId or symbol is required")).max(10).optional(),
  assetTypes: z.array(z.object({ type: assetTypeSchema, ...range })).max(10).optional(),
  sectors: z.array(z.object({ sector: instrumentSectorSchema, ...range })).max(10).optional(),
  tags: z.array(z.string().regex(/^[a-z0-9-]{2,32}$/)).max(10).optional(),
  maxSingleWeightBps: bps.optional(),
  maxMinimumInvestmentUsdc: decimalStringSchema.optional(),
  maxFeeBps: z.object({ entry: bps.optional(), management: bps.optional(), rebalance: bps.optional(), subscription: bps.optional() }).optional(),
  reviewFrequencies: z.array(z.enum(["none", "monthly", "quarterly"])).max(3).optional(),
  minBasketAgeDays: z.number().int().min(0).max(3650).optional(),
  performance: z.object({ minNetReturn1y: fractionSchema.optional(), minNetReturnSinceLaunch: fractionSchema.optional(), maxVolatility: fractionSchema.optional(), maxDrawdown: fractionSchema.optional() }).optional(),
  minManagerExperienceYears: z.number().int().min(0).max(60).optional(),
  sort: discoverySortSchema.optional(),
  cursor: z.string().max(300).optional(),
});
export type DiscoveryFilters = z.infer<typeof discoveryFiltersSchema>;

/** Filters travel in the URL as one `f` param: base64url JSON. */
export const discoveryQuerySchema = z.object({ f: z.string().max(4000).optional(), cursor: z.string().max(300).optional() });

/** Effective fee in basis points of the minimum investment: percent → `bps`; fixed → `amount × 10000 / minimum`, rounded half-up (exact, micro-USDC). */
export function effectiveFeeBps(fee: Fee | { amountUsdc: string }, minimumUsdc: string): number {
  if ("type" in fee && fee.type === "percent") return fee.bps;
  const min = micro(minimumUsdc);
  return Number((2n * micro((fee as { amountUsdc: string }).amountUsdc) * 10_000n + min) / (2n * min));
}

const plain = (min: number, max: number) => z.string().trim().min(min).max(max);
export const managerProfileRequestSchema = z.strictObject({
  // "apply" and "status" are static routes under /managers, so a profile with that handle could never be reached.
  handle: z.string().regex(/^[a-z0-9-]{3,30}$/).refine((h) => h !== "apply" && h !== "status", "That handle is reserved."),
  displayName: plain(2, 80),
  headline: plain(1, 120).nullable().optional(),
  bio: plain(1, 2000).nullable().optional(),
  experienceYears: z.number().int().min(0).max(60).nullable().optional(),
  background: plain(1, 2000).nullable().optional(),
  qualifications: z.array(plain(1, 120)).max(10).optional(),
  links: z.array(z.strictObject({ label: plain(1, 40), url: z.url({ protocol: /^https$/ }).max(500) })).max(5).optional(),
});
export type ManagerProfileRequest = z.infer<typeof managerProfileRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Responses and requests
// ---------------------------------------------------------------------------------------------------------------------

const iso = z.iso.datetime({ offset: true });
export const discoverySearchItemSchema = z.object({
  slug: z.string(), name: z.string(), shortDescription: z.string().nullable(), organizationName: z.string(), category: basketCategorySchema, status: basketStatusSchema,
  topAssets: z.array(z.object({ symbol: z.string(), bps: z.number() })), minimumInvestmentUsdc: z.string(), managementFeeBps: z.number(), netReturn1y: z.string().nullable(), available: z.boolean(),
  /** Annualised volatility of the simulated model (a fraction); null until performance is available. */
  volatility: z.string().nullable(),
  /** The basket holds tokenized assets, which need an eligibility declaration to buy. */
  hasEligibilityRequirements: z.boolean(),
});
export type DiscoverySearchItem = z.infer<typeof discoverySearchItemSchema>;
export const discoverySearchResponseSchema = z.object({ items: z.array(discoverySearchItemSchema), nextCursor: z.string().nullable() });
export type DiscoverySearchResponse = z.infer<typeof discoverySearchResponseSchema>;

/**
 * Home and discovery rails. `featured`: curated by Bytesac operations (ordered by rank). `trending`: most distinct new
 * investors over the last 30 days, only baskets with at least 5 (the adoption masking threshold), never with counts.
 */
export const discoveryCollectionsResponseSchema = z.object({ featured: z.array(discoverySearchItemSchema), trending: z.array(discoverySearchItemSchema) });
export type DiscoveryCollectionsResponse = z.infer<typeof discoveryCollectionsResponseSchema>;
/** Signed-in suggestions: listed baskets in the categories the user already holds, excluding baskets they hold; newest first. */
export const suggestedBasketsResponseSchema = z.object({ items: z.array(discoverySearchItemSchema), basis: z.enum(["your_categories", "newest"]) });
export type SuggestedBasketsResponse = z.infer<typeof suggestedBasketsResponseSchema>;
export const setBasketFeaturedRequestSchema = z.strictObject({ rank: z.number().int().min(1).max(99).nullable() });
export type SetBasketFeaturedRequest = z.infer<typeof setBasketFeaturedRequestSchema>;
export const setBasketFeaturedResponseSchema = z.object({ basketId: z.string(), rank: z.number().int().nullable() });
export type SetBasketFeaturedResponse = z.infer<typeof setBasketFeaturedResponseSchema>;

export const aiSearchRequestSchema = z.strictObject({ query: z.string().trim().min(1).max(500) });
export type AiSearchRequest = z.infer<typeof aiSearchRequestSchema>;
export const aiSearchResponseSchema = z.object({
  mode: z.enum(["tool", "semantic", "keyword"]), filters: discoveryFiltersSchema.omit({ cursor: true }).nullable(), results: z.array(discoverySearchItemSchema),
});
export type AiSearchResponse = z.infer<typeof aiSearchResponseSchema>;

export const managerHandleParamSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]{3,30}$/) });

const profileFields = {
  handle: z.string(), displayName: z.string(), headline: z.string().nullable(), bio: z.string().nullable(), experienceYears: z.number().nullable(), background: z.string().nullable(),
  qualifications: z.array(z.string()), links: z.array(z.object({ label: z.string(), url: z.string() })),
};
export const managerProfileViewSchema = z.object({ ...profileFields, status: z.enum(["draft", "published", "hidden"]), hiddenReason: z.string().nullable(), publishedAt: iso.nullable(), updatedAt: iso });
export type ManagerProfileView = z.infer<typeof managerProfileViewSchema>;
export const ownManagerProfileResponseSchema = z.object({ profile: managerProfileViewSchema.nullable() });
export type OwnManagerProfileResponse = z.infer<typeof ownManagerProfileResponseSchema>;

export const publicManagerSchema = z.object({
  ...profileFields,
  selfReported: z.array(z.enum(["experienceYears", "qualifications"])),
  verified: z.boolean(),
  baskets: z.array(z.object({ slug: z.string(), name: z.string(), status: basketStatusSchema, role: z.enum(["lead", "co_manager"]), from: iso, to: iso.nullable() })),
  organizations: z.array(z.object({ organizationId: z.string(), organizationName: z.string().nullable(), role: z.string(), title: z.string().nullable(), current: z.boolean(), from: iso, to: iso.nullable() })),
});
export type PublicManager = z.infer<typeof publicManagerSchema>;

export const opsManagerProfileSchema = z.object({
  id: z.string(), handle: z.string(), displayName: z.string(), status: z.enum(["draft", "published", "hidden"]), hiddenReason: z.string().nullable(), publishedAt: iso.nullable(), updatedAt: iso,
});
export const listOpsManagerProfilesQuerySchema = z.object({ status: z.enum(["draft", "published", "hidden"]).optional(), cursor: z.string().max(200).optional() });
export type ListOpsManagerProfilesQuery = z.infer<typeof listOpsManagerProfilesQuerySchema>;
export const listOpsManagerProfilesResponseSchema = z.object({ items: z.array(opsManagerProfileSchema), nextCursor: z.string().nullable() });
export type ListOpsManagerProfilesResponse = z.infer<typeof listOpsManagerProfilesResponseSchema>;
export const hideManagerProfileRequestSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type HideManagerProfileRequest = z.infer<typeof hideManagerProfileRequestSchema>;

export const assetTagViewSchema = z.object({ id: z.string(), key: z.string(), label: z.string(), status: z.enum(["active", "retired"]), createdAt: iso, retiredAt: iso.nullable() });
export type AssetTagView = z.infer<typeof assetTagViewSchema>;
export const listAssetTagsResponseSchema = z.object({ tags: z.array(assetTagViewSchema) });
export type ListAssetTagsResponse = z.infer<typeof listAssetTagsResponseSchema>;
export const createAssetTagRequestSchema = z.strictObject({ key: z.string().regex(/^[a-z0-9-]{2,32}$/), label: z.string().trim().min(1).max(40) });
export type CreateAssetTagRequest = z.infer<typeof createAssetTagRequestSchema>;
