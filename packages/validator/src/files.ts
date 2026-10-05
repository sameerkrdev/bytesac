import { z } from "zod";

/*
 * Browser-to-R2 uploads outside the organization-document flow: asset (instrument) logos set by operations, and files a
 * manager attaches to a basket version (thesis, factsheet…). Presign → PUT to `uploadUrl` with `headers` → confirm.
 */

export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_LOGO_BYTES = 512 * 1024;
export const BASKET_FILE_CONTENT_TYPES = ["application/pdf"] as const;
export const MAX_BASKET_FILE_BYTES = 20 * 1024 * 1024;
/** Live files per basket version. */
export const MAX_BASKET_FILES = 10;

export const presignLogoRequestSchema = z.strictObject({
  contentType: z.enum(LOGO_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_LOGO_BYTES),
});
export type PresignLogoRequest = z.infer<typeof presignLogoRequestSchema>;

export const BASKET_FILE_KINDS = ["thesis", "factsheet", "methodology", "research", "other"] as const;
export const basketFileKindSchema = z.enum(BASKET_FILE_KINDS);
export type BasketFileKind = z.infer<typeof basketFileKindSchema>;

export const presignBasketFileRequestSchema = z.strictObject({
  /** Display only; stripped of path segments server-side. */
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(BASKET_FILE_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_BASKET_FILE_BYTES),
});
export type PresignBasketFileRequest = z.infer<typeof presignBasketFileRequestSchema>;
/** Confirming an uploaded basket file names it and says what it is. */
export const confirmBasketFileRequestSchema = z.strictObject({ kind: basketFileKindSchema, title: z.string().trim().min(1).max(120) });
export type ConfirmBasketFileRequest = z.infer<typeof confirmBasketFileRequestSchema>;

export const presignFileResponseSchema = z.object({
  fileId: z.uuid(),
  uploadUrl: z.url(),
  headers: z.object({ "Content-Type": z.string() }),
});
export type PresignFileResponse = z.infer<typeof presignFileResponseSchema>;

/** A file linked to a basket version. `url` is a short-lived signed download link. */
export const basketFileViewSchema = z.object({
  id: z.uuid(), kind: basketFileKindSchema, title: z.string(), fileName: z.string().nullable(), contentType: z.string(), sizeBytes: z.number().int(), url: z.string(), addedAt: z.string(),
});
export type BasketFileView = z.infer<typeof basketFileViewSchema>;
export const basketFilesResponseSchema = z.object({ files: z.array(basketFileViewSchema) });
export type BasketFilesResponse = z.infer<typeof basketFilesResponseSchema>;
