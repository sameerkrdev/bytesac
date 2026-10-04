import createHttpError from "http-errors";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { basketVersionFiles, basketVersions, baskets, db, type Tx } from "@repo/db";
import { MAX_BASKET_FILES, type BasketDetail, type ConfirmBasketFileRequest, type PresignBasketFileRequest, type PresignFileResponse } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { writeAudit } from "@/modules/audit/audit.service";
import { pendingFile, presignFile, storeFile } from "@/modules/files/files.service";
import type { OwnerCtx } from "@/modules/organizations/organizations.service";
import { getBasketForMember, openVersionOf, READ_ONLY, requireBasketAction } from "./baskets.service";

/*
 * Files on a basket version (Spec 17 round 2): attached to the open draft by members who may edit it, reviewed with the
 * version, frozen once it is published. Uploading needs the same `edit` authority as saving the draft.
 */

const EDITABLE: readonly string[] = ["draft", "changes_required"];
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });

/** The editable open version under the basket lock, with its live file count. */
async function editableDraft(tx: Tx | typeof db, userId: string, bid: string, lock: boolean) {
  const { basket } = await requireBasketAction(tx, userId, bid, "edit", lock);
  if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
  const v = await openVersionOf(tx, bid, lock);
  if (!v) throw invalid("There is no open version to edit.");
  if (!EDITABLE.includes(v.status)) throw invalid("This version is frozen; files can't be changed now.");
  const [{ n }] = await tx.select({ n: count() }).from(basketVersionFiles).where(and(eq(basketVersionFiles.versionId, v.id), isNull(basketVersionFiles.removedAt))) as [{ n: number }];
  return { basket, v, live: n };
}

export async function presignBasketFile(ctx: OwnerCtx, bid: string, body: PresignBasketFileRequest): Promise<PresignFileResponse> {
  const { basket, live } = await editableDraft(db, ctx.userId, bid, false);
  if (live >= MAX_BASKET_FILES) throw invalid(`A version can have at most ${MAX_BASKET_FILES} files.`);
  await consume(limits.documentPresignOrg, basket.organizationId);
  return presignFile({ purpose: "basket_file", userId: ctx.userId, contentType: body.contentType, sizeBytes: body.sizeBytes, originalName: body.fileName });
}

/** Checks the upload and links it to the open draft; this is an edit of the version, so it bumps its revision. */
export async function confirmBasketFile(ctx: OwnerCtx, bid: string, fileId: string, body: ConfirmBasketFileRequest): Promise<BasketDetail> {
  await editableDraft(db, ctx.userId, bid, false);
  const file = await pendingFile(fileId, "basket_file", ctx.userId);
  await storeFile(file, async (tx) => {
    const { v, live } = await editableDraft(tx, ctx.userId, bid, true);
    if (live >= MAX_BASKET_FILES) throw invalid(`A version can have at most ${MAX_BASKET_FILES} files.`);
    const [link] = await tx.insert(basketVersionFiles).values({ versionId: v.id, fileId: file.id, kind: body.kind, title: body.title }).returning({ id: basketVersionFiles.id });
    await touch(tx, bid, v.id);
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.file_added", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: v.id, linkId: link!.id, fileId: file.id, kind: body.kind } });
  });
  return getBasketForMember(ctx, bid);
}

/** Unlinks a file from the open draft (the stored object and earlier versions' links stay). */
export async function removeBasketFile(ctx: OwnerCtx, bid: string, linkId: string): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { v } = await editableDraft(tx, ctx.userId, bid, true);
    const [removed] = await tx.update(basketVersionFiles).set({ removedAt: sql`now()` })
      .where(and(eq(basketVersionFiles.id, linkId), eq(basketVersionFiles.versionId, v.id), isNull(basketVersionFiles.removedAt))).returning({ fileId: basketVersionFiles.fileId });
    if (!removed) throw createHttpError("File not found", { code: "NOT_FOUND" });
    await touch(tx, bid, v.id);
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.file_removed", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: v.id, linkId, fileId: removed.fileId } });
  });
  return getBasketForMember(ctx, bid);
}

async function touch(tx: Tx, bid: string, versionId: string) {
  await tx.update(basketVersions).set({ revision: sql`${basketVersions.revision} + 1`, updatedAt: sql`now()` }).where(eq(basketVersions.id, versionId));
  await tx.update(baskets).set({ updatedAt: sql`now()` }).where(eq(baskets.id, bid));
}
