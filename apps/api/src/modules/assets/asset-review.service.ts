import createHttpError from "http-errors";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, executionRoutes, instrumentDeployments, instruments } from "@repo/db";
import { ASSET_ITEM_TRANSITIONS, INSTRUMENT_TRANSITIONS, type AssetDecisionRequest, type AssetItemStatus, type InstrumentStatus, type OpsAssetDetail } from "@repo/validator";
import type { OpsCtx } from "@/modules/manager-applications/applications.service";
import { deploymentProblem, getAssetForOps, lockEditable, lockInstrument, missingRequirements, recordAssetEvent } from "./assets.service";

const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const incomplete = (missing: string[]) => createHttpError("This asset is missing required information.", { code: "REQUIREMENTS_INCOMPLETE", details: { missing } });
const items = [["deployment", instrumentDeployments], ["route", executionRoutes]] as const;

export async function submitInstrument(ctx: OpsCtx, id: string): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    const row = await lockInstrument(tx, id);
    if (row.status !== "DRAFT" && row.status !== "CHANGES_REQUIRED") throw invalid("This asset can't be submitted in its current state.");
    const missing = await missingRequirements(tx, id);
    if (missing.length) throw incomplete(missing);
    await tx.update(instruments).set({ status: "UNDER_REVIEW", submittedByUserId: ctx.userId, updatedAt: sql`now()` }).where(eq(instruments.id, id));
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "instrument", entityId: id, kind: "submitted", fromStatus: row.status, toStatus: "UNDER_REVIEW" });
  });
  return getAssetForOps(id);
}

/** The submitter of the review in front of the admin cannot decide it; requirements are checked again at approval. */
export async function decideInstrument(ctx: OpsCtx, id: string, body: AssetDecisionRequest): Promise<OpsAssetDetail> {
  await db.transaction(async (tx) => {
    const row = await lockInstrument(tx, id);
    if (row.status !== "UNDER_REVIEW") throw invalid("This asset is not waiting for review.");
    if (row.submittedByUserId === ctx.userId) throw createHttpError("You can't review a submission you made.", { code: "FORBIDDEN" });
    if (body.decision === "approved") {
      const missing = await missingRequirements(tx, id);
      if (missing.length) throw incomplete(missing);
    }
    const to = body.decision === "approved" ? "APPROVED" : "CHANGES_REQUIRED";
    await tx.update(instruments).set({ status: to, decidedByUserId: ctx.userId, updatedAt: sql`now()` }).where(eq(instruments.id, id));
    if (to === "APPROVED") {
      for (const [entityType, table] of items) {
        const approved = await tx.update(table).set({ status: "APPROVED", approvedByUserId: ctx.userId, updatedAt: sql`now()` })
          .where(and(eq(table.instrumentId, id), eq(table.status, "DRAFT"))).returning({ id: table.id });
        for (const item of approved) await recordAssetEvent(tx, ctx, { instrumentId: id, entityType, entityId: item.id, kind: "approved", fromStatus: "DRAFT", toStatus: "APPROVED" });
      }
    }
    await recordAssetEvent(tx, ctx, {
      instrumentId: id, entityType: "instrument", entityId: id, kind: "decided", fromStatus: row.status, toStatus: to,
      message: body.message, internalNote: body.internalNote, metadata: { decision: body.decision },
    });
  });
  return getAssetForOps(id);
}

type InstrumentAction = "activate" | "pause" | "resume" | "deprecate" | "retire";
const INSTRUMENT_ACTIONS: Record<InstrumentAction, { to: InstrumentStatus; from?: InstrumentStatus; kind: "activated" | "paused" | "resumed" | "deprecated" | "retired" }> = {
  activate: { to: "ACTIVE", from: "APPROVED", kind: "activated" },
  pause: { to: "PAUSED", kind: "paused" },
  resume: { to: "ACTIVE", from: "PAUSED", kind: "resumed" },
  deprecate: { to: "DEPRECATED", kind: "deprecated" },
  retire: { to: "RETIRED", kind: "retired" },
};

/**
 * Activating also activates the instrument's APPROVED items. Retiring also retires its live items: a retired instrument can no longer be edited,
 * so its tokens would otherwise stay registered (and unusable) forever. Pause and deprecate do not cascade; reads require the instrument and the item to be ACTIVE.
 */
export async function transitionInstrument(ctx: OpsCtx, id: string, action: InstrumentAction): Promise<OpsAssetDetail> {
  const { to, from, kind } = INSTRUMENT_ACTIONS[action];
  await db.transaction(async (tx) => {
    const row = await lockInstrument(tx, id);
    if (!INSTRUMENT_TRANSITIONS[row.status].includes(to) || (from && row.status !== from)) throw invalid(`An asset in ${row.status} cannot be ${kind}.`);
    await tx.update(instruments).set({ status: to, updatedAt: sql`now()` }).where(eq(instruments.id, id));
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType: "instrument", entityId: id, kind, fromStatus: row.status, toStatus: to });
    if (action === "activate" || action === "retire") {
      for (const [entityType, table] of items) {
        const changed = await tx.update(table).set({ status: action === "activate" ? "ACTIVE" : "RETIRED", updatedAt: sql`now()` })
          .where(and(eq(table.instrumentId, id), action === "activate" ? eq(table.status, "APPROVED") : ne(table.status, "RETIRED"))).returning({ id: table.id, status: table.status });
        for (const item of changed) await recordAssetEvent(tx, ctx, { instrumentId: id, entityType, entityId: item.id, kind, toStatus: item.status });
      }
    }
  });
  return getAssetForOps(id);
}

type ItemAction = "approve" | "activate" | "pause" | "resume" | "retire";
const ITEM_ACTIONS: Record<ItemAction, { to: AssetItemStatus; from?: AssetItemStatus; kind: "approved" | "activated" | "paused" | "resumed" | "retired" }> = {
  approve: { to: "APPROVED", kind: "approved" },
  activate: { to: "ACTIVE", from: "APPROVED", kind: "activated" },
  pause: { to: "PAUSED", kind: "paused" },
  resume: { to: "ACTIVE", from: "PAUSED", kind: "resumed" },
  retire: { to: "RETIRED", kind: "retired" },
};

/** Per-item lifecycle for deployments and routes added after launch. Any `ops_admin` may approve an item (separation of duties applies to the instrument submission). */
export async function transitionAssetItem(ctx: OpsCtx, id: string, kind: "deployments" | "routes", itemId: string, action: ItemAction): Promise<OpsAssetDetail> {
  const { to, from, kind: eventKind } = ITEM_ACTIONS[action];
  const [entityType, table] = kind === "deployments" ? items[0] : items[1];
  await db.transaction(async (tx) => {
    const inst = await lockEditable(tx, id);
    const [item] = await tx.select().from(table).where(and(eq(table.id, itemId), eq(table.instrumentId, id))).for("update");
    if (!item) throw createHttpError(`${entityType === "route" ? "Route" : "Deployment"} not found`, { code: "NOT_FOUND" });
    if (!ASSET_ITEM_TRANSITIONS[item.status].includes(to) || (from && item.status !== from)) throw invalid(`An item in ${item.status} cannot be ${eventKind}.`);
    if ((action === "approve" || action === "activate") && !(["APPROVED", "ACTIVE", "PAUSED"] as InstrumentStatus[]).includes(inst.status)) throw invalid("The asset must be approved first.");
    if (action === "approve") {
      if ("verification" in item) {
        const problem = deploymentProblem(item);
        if (problem) throw incomplete([problem]);
      } else {
        const [deployment] = await tx.select({ status: instrumentDeployments.status }).from(instrumentDeployments).where(eq(instrumentDeployments.id, item.deploymentId));
        if (!deployment || deployment.status === "RETIRED") throw incomplete(["deployment"]);
      }
    }
    await tx.update(table).set({ status: to, updatedAt: sql`now()`, ...(action === "approve" ? { approvedByUserId: ctx.userId } : {}) }).where(eq(table.id, itemId));
    await recordAssetEvent(tx, ctx, { instrumentId: id, entityType, entityId: itemId, kind: eventKind, fromStatus: item.status, toStatus: to });
  });
  return getAssetForOps(id);
}
