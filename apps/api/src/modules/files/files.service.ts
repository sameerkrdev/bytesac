import { randomUUID } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import createHttpError from "http-errors";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, storedFiles, type Tx } from "@repo/db";
import { logger } from "@repo/logger";
import type { PresignFileResponse } from "@repo/validator";
import { R2_BUCKET, r2 } from "@/providers/r2";

/*
 * Generic browser-to-R2 uploads (asset logos, basket version files). Mirrors the organization-document flow: the row is
 * created `pending_upload` with the declared type and size, the browser PUTs to `incoming/`, and confirm checks the object
 * (size, type, leading bytes) before copying it to its final key. Objects are never served from our origin.
 */

const PRESIGN_TTL_SEC = 300;
/** Signed read links for display (logos) and downloads (basket files). */
export const READ_TTL_SEC = 60 * 60;

type Purpose = (typeof storedFiles.$inferSelect)["purpose"];
export type StoredFile = typeof storedFiles.$inferSelect;

/** Leading bytes per allowed type; `null` matches any byte (WebP is RIFF????WEBP). */
const MAGIC: Record<string, Array<number | null>> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};
const EXTENSION: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A display-safe file name: last path segment, no control or quote characters, bounded length. */
export const safeFileName = (name: string) => name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200) || "file";

export async function presignFile(i: { purpose: Purpose; userId: string; contentType: string; sizeBytes: number; originalName?: string }): Promise<PresignFileResponse> {
  if (!MAGIC[i.contentType]) throw createHttpError("Unsupported file type", { code: "VALIDATION_FAILED" });
  const fileId = randomUUID();
  const key = `incoming/files/${i.purpose}/${fileId}`;
  await db.insert(storedFiles).values({
    id: fileId, purpose: i.purpose, r2Key: key, contentType: i.contentType, sizeBytes: i.sizeBytes, originalName: i.originalName ? safeFileName(i.originalName) : null, uploadedByUserId: i.userId,
  });
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: i.contentType, ContentLength: i.sizeBytes }), {
    expiresIn: PRESIGN_TTL_SEC, signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { fileId, uploadUrl, headers: { "Content-Type": i.contentType } };
}

/** The pending file `fileId` of `purpose`, uploaded by `userId` (only the uploader can confirm their own upload). */
export async function pendingFile(fileId: string, purpose: Purpose, userId: string): Promise<StoredFile> {
  const [f] = await db.select().from(storedFiles).where(and(eq(storedFiles.id, fileId), eq(storedFiles.purpose, purpose), eq(storedFiles.uploadedByUserId, userId)));
  if (!f) throw createHttpError("File not found", { code: "NOT_FOUND" });
  if (f.status !== "pending_upload") throw createHttpError("This file was already processed.", { code: "INVALID_TRANSITION" });
  return f;
}

/**
 * Checks the uploaded object, copies it to its final key and, in one transaction, marks it uploaded and runs `link`.
 * The object is untrusted: size and type must match what was declared, and the leading bytes must match the type.
 */
export async function storeFile(f: StoredFile, link: (tx: Tx) => Promise<void>): Promise<void> {
  const magic = MAGIC[f.contentType]!;
  const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: f.r2Key })).catch(() => null);
  const first = head && head.ContentLength === f.sizeBytes && head.ContentType === f.contentType
    ? Buffer.from(await (await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: f.r2Key, Range: `bytes=0-${magic.length - 1}` }))).Body!.transformToByteArray())
    : null;
  const ok = first !== null && magic.every((b, i) => b === null || first[i] === b);
  if (!ok) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: f.r2Key })).catch(() => undefined);
    await db.update(storedFiles).set({ status: "rejected_file" }).where(and(eq(storedFiles.id, f.id), eq(storedFiles.status, "pending_upload")));
    throw createHttpError(422, "This file doesn't match its type or size.", { code: "DOCUMENT_REJECTED" });
  }
  const finalKey = `files/${f.purpose}/${f.id}.${EXTENSION[f.contentType]}`;
  await r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, CopySource: `${R2_BUCKET}/${f.r2Key}`, Key: finalKey }));
  try {
    await db.transaction(async (tx) => {
      const done = await tx.update(storedFiles).set({ status: "uploaded", r2Key: finalKey, uploadedAt: sql`now()` })
        .where(and(eq(storedFiles.id, f.id), eq(storedFiles.status, "pending_upload"))).returning({ id: storedFiles.id });
      if (done.length === 0) throw createHttpError("This file was already processed.", { code: "INVALID_TRANSITION" });
      await link(tx);
    });
  } catch (err) {
    const [linked] = await db.select({ id: storedFiles.id }).from(storedFiles).where(eq(storedFiles.r2Key, finalKey)).limit(1);
    if (!linked) await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: finalKey })).catch((e: unknown) => logger.warn("could not delete an orphan file copy", { key: finalKey, errMessage: e instanceof Error ? e.message : "unknown" }));
    throw err;
  }
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: f.r2Key })).catch(() => undefined);
}

/** A signed read link. `download` sets an attachment disposition with the stored display name. */
export function readUrl(f: Pick<StoredFile, "r2Key" | "contentType" | "originalName">, download = false): Promise<string> {
  const name = (f.originalName ?? `file.${EXTENSION[f.contentType] ?? "bin"}`).replace(/[^\w.\- ()]/g, "_");
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: f.r2Key, ...(download && { ResponseContentDisposition: `attachment; filename="${name}"` }) }), { expiresIn: READ_TTL_SEC });
}

/** Signed logo URLs for many uploaded files at once (`fileId → url`); unknown or unfinished files are skipped. */
export async function logoUrls(fileIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(fileIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: storedFiles.id, r2Key: storedFiles.r2Key, contentType: storedFiles.contentType, originalName: storedFiles.originalName })
    .from(storedFiles).where(and(inArray(storedFiles.id, ids), eq(storedFiles.status, "uploaded")));
  return new Map(await Promise.all(rows.map(async (r) => [r.id, await readUrl(r)] as const)));
}
