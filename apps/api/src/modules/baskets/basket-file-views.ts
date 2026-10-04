import { and, asc, eq, isNull } from "drizzle-orm";
import { basketVersionFiles, storedFiles, type DbOrTx, type Tx } from "@repo/db";
import type { BasketFileView } from "@repo/validator";
import { readUrl } from "@/modules/files/files.service";

/** Live files of a version, oldest first, each with a short-lived signed download link. */
export async function versionFiles(conn: DbOrTx, versionId: string): Promise<BasketFileView[]> {
  const rows = await conn.select({
    id: basketVersionFiles.id, kind: basketVersionFiles.kind, title: basketVersionFiles.title, addedAt: basketVersionFiles.createdAt,
    r2Key: storedFiles.r2Key, contentType: storedFiles.contentType, sizeBytes: storedFiles.sizeBytes, originalName: storedFiles.originalName,
  }).from(basketVersionFiles).innerJoin(storedFiles, eq(storedFiles.id, basketVersionFiles.fileId))
    .where(and(eq(basketVersionFiles.versionId, versionId), isNull(basketVersionFiles.removedAt))).orderBy(asc(basketVersionFiles.createdAt), asc(basketVersionFiles.id));
  return Promise.all(rows.map(async (r) => ({
    id: r.id, kind: r.kind, title: r.title, fileName: r.originalName, contentType: r.contentType, sizeBytes: r.sizeBytes, url: await readUrl(r, true), addedAt: r.addedAt.toISOString(),
  })));
}

/** Stored-file ids of a version's live files, sorted (part of the content hash when there are any). */
export async function versionFileIds(conn: DbOrTx, versionId: string): Promise<string[]> {
  const rows = await conn.select({ fileId: basketVersionFiles.fileId }).from(basketVersionFiles).where(and(eq(basketVersionFiles.versionId, versionId), isNull(basketVersionFiles.removedAt)));
  return rows.map((r) => r.fileId).sort();
}

/** A new draft starts with the published version's files (same stored objects, new links). */
export async function copyFilesForward(tx: Tx, fromVersionId: string, toVersionId: string): Promise<void> {
  const rows = await tx.select({ fileId: basketVersionFiles.fileId, kind: basketVersionFiles.kind, title: basketVersionFiles.title }).from(basketVersionFiles)
    .where(and(eq(basketVersionFiles.versionId, fromVersionId), isNull(basketVersionFiles.removedAt))).orderBy(asc(basketVersionFiles.createdAt), asc(basketVersionFiles.id));
  if (rows.length) await tx.insert(basketVersionFiles).values(rows.map((r) => ({ ...r, versionId: toVersionId })));
}
