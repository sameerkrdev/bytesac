import { db } from "@repo/db";
import { truncateAppTables } from "@repo/db/testing";
import postgres from "postgres";
import { redis } from "../../src/middleware/rate-limit";
import { resetFakes } from "./fakes";

export const adminSql = postgres(process.env.TEST_ADMIN_DATABASE_URL ?? "", { max: 2, onnotice: () => undefined });
export const testDb = { db };

/** Clean slate for a test: empty tables, empty rate-limit counters, default fakes. */
export async function resetDb(): Promise<void> {
  await truncateAppTables(adminSql);
  await redis.flushdb();
  resetFakes();
}
