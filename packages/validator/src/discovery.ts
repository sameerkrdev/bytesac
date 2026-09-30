import { z } from "zod";
import { assetTypeSchema } from "./assets";
import { basketCategorySchema, decimalStringSchema, micro, type Fee } from "./baskets";

export const PERFORMANCE_LABEL =
  "Simulated model performance — not actual investor results. Net figures assume an investment equal to the basket minimum and include the basket's fees; network and swap costs are excluded.";

export const INSTRUMENT_SECTORS = [
  "store_of_value", "smart_contract_platform", "layer2", "defi", "stablecoin", "oracle_infra", "gaming_metaverse", "ai_data", "meme", "rwa_treasury", "rwa_credit", "rwa_commodity", "rwa_equity", "other",
] as const;
export const instrumentSectorSchema = z.enum(INSTRUMENT_SECTORS);
export type InstrumentSector = z.infer<typeof instrumentSectorSchema>;

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
  handle: z.string().regex(/^[a-z0-9-]{3,30}$/),
  displayName: plain(2, 80),
  headline: plain(1, 120).nullable().optional(),
  bio: plain(1, 2000).nullable().optional(),
  experienceYears: z.number().int().min(0).max(60).nullable().optional(),
  background: plain(1, 2000).nullable().optional(),
  qualifications: z.array(plain(1, 120)).max(10).optional(),
  links: z.array(z.strictObject({ label: plain(1, 40), url: z.url({ protocol: /^https$/ }).max(500) })).max(5).optional(),
});
export type ManagerProfileRequest = z.infer<typeof managerProfileRequestSchema>;
