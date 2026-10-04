import { bigint, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app, documentStatus } from "./enums";
import { users } from "./identity";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const storedFilePurpose = app.enum("stored_file_purpose", ["instrument_logo", "basket_file"]);

/**
 * A file uploaded straight to R2 by the browser (presign → PUT → confirm). Same lifecycle as organization documents:
 * `pending_upload` until the server has checked size, type and leading bytes, then `uploaded` under its final key.
 * Rows are never deleted; whatever links a file (an instrument's logo, a basket version) decides whether it is in use.
 */
export const storedFiles = app.table(
  "stored_files",
  {
    id: id(),
    purpose: storedFilePurpose("purpose").notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** The uploader's file name, for display only (never used to build keys or paths). */
    originalName: text("original_name"),
    status: documentStatus("status").notNull().default("pending_upload"),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    uploadedAt: ts("uploaded_at"),
  },
  (t) => [index("stored_files_uploader_idx").on(t.uploadedByUserId, t.createdAt)],
);
