import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { assetProviders, eligibilityDecisions, eligibilityDeclarations, eligibilityRules, executionRoutes, type DbOrTx } from "@repo/db";
import { RWA_ASSET_TYPES, evaluateEligibility, type AssetType, type EligibilityResult } from "@repo/validator";
import { selectRouteProvider } from "../providers/routes";

/** Route methods an RWA may use in release 1: synchronous secondary-market trades through LI.FI (Spec 11 decision 1). */
export const RWA_ROUTE_METHODS = ["swap", "secondary_market"] as const;
export const isRwa = (assetType: AssetType): boolean => RWA_ASSET_TYPES.includes(assetType);

export type Evaluated = EligibilityResult & { declarationId: string | null; routeId: string | null };
export interface EvalItem { instrumentId: string; assetType: AssetType; deploymentId: string; action: "acquire" | "sell" }

/**
 * Spec 11 section 6 for several assets at once (one action per instrument per call): loads the ACTIVE rules, the deployments' LI.FI routes and the user's
 * latest declaration once. The route is the first ACTIVE swap/secondary_market route of the deployment whose provider is enabled.
 */
export async function evaluateFor(conn: DbOrTx, i: { userId: string; ipCountry: string | null; items: EvalItem[] }): Promise<Map<string, Evaluated>> {
  const out = new Map<string, Evaluated>();
  if (i.items.length === 0) return out;
  const rules = await conn.select().from(eligibilityRules).where(and(inArray(eligibilityRules.instrumentId, i.items.map((x) => x.instrumentId)), eq(eligibilityRules.status, "ACTIVE")));
  const routes = await conn.select({ id: executionRoutes.id, deploymentId: executionRoutes.deploymentId, provider: assetProviders.name }).from(executionRoutes)
    .innerJoin(assetProviders, eq(assetProviders.id, executionRoutes.providerId))
    .where(and(inArray(executionRoutes.deploymentId, i.items.map((x) => x.deploymentId)), eq(executionRoutes.status, "ACTIVE"), inArray(executionRoutes.method, RWA_ROUTE_METHODS)))
    .orderBy(asc(executionRoutes.createdAt), asc(executionRoutes.id));
  const [declaration] = await conn.select().from(eligibilityDeclarations).where(eq(eligibilityDeclarations.userId, i.userId)).orderBy(desc(eligibilityDeclarations.createdAt), desc(eligibilityDeclarations.id)).limit(1);
  const now = new Date();
  for (const item of i.items) {
    const routeId = routes.find((r) => r.deploymentId === item.deploymentId && selectRouteProvider([r.provider]))?.id ?? null;
    const result = evaluateEligibility({
      rwa: isRwa(item.assetType), instrumentId: item.instrumentId, routeId, action: item.action, rules, now, ipCountry: i.ipCountry,
      declaration: declaration ? { country: declaration.country, investorStatus: declaration.investorStatus, createdAt: declaration.createdAt } : null,
    });
    out.set(item.instrumentId, { ...result, declarationId: declaration?.id ?? null, routeId });
  }
  return out;
}

/** Appends decision rows (never stored for `DECLARATION_REQUIRED`: no plan or leg exists then). */
export async function recordDecisions(tx: DbOrTx, rows: { operationId: string | null; legId: string | null; userId: string; ipCountry: string | null; instrumentId: string; action: "acquire" | "sell"; result: Evaluated }[]): Promise<void> {
  const stored = rows.flatMap((r) => (r.result.outcome === "DECLARATION_REQUIRED" ? [] : [{
    operationId: r.operationId, legId: r.legId, userId: r.userId, instrumentId: r.instrumentId, routeId: r.result.routeId, action: r.action,
    outcome: r.result.outcome, ruleIds: r.result.ruleIds, declarationId: r.result.declarationId, ipCountry: r.ipCountry,
  }]));
  if (stored.length) await tx.insert(eligibilityDecisions).values(stored);
}

/** The first result that is not ALLOWED becomes a 409: `DECLARATION_REQUIRED`, or `NOT_ELIGIBLE` with every blocking reason. */
export function assertAllowed(results: Map<string, Evaluated>): void {
  const blocked = [...results].filter(([, r]) => r.outcome !== "ALLOWED");
  if (blocked.some(([, r]) => r.outcome === "DECLARATION_REQUIRED")) throw createHttpError(409, "Tell us your country and investor status first.", { code: "DECLARATION_REQUIRED" });
  if (blocked.length) throw createHttpError(409, "This isn't available to you.", { code: "NOT_ELIGIBLE", details: { reasons: blocked.map(([instrumentId, r]) => ({ instrumentId, outcome: r.outcome, reason: r.reason })) } });
}

/** What a plan records for a leg (or a sell exclusion) once the operation and leg ids exist. */
export interface DecisionDraft { instrumentId: string; action: "acquire" | "sell"; result: Evaluated }
export const decisionOf = (m: Map<string, Evaluated>, instrumentId: string, action: DecisionDraft["action"]): DecisionDraft | undefined => (m.has(instrumentId) ? { instrumentId, action, result: m.get(instrumentId)! } : undefined);
