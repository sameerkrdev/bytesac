import postgres from "postgres";
import { runMigrations } from "../src/db/migrate.js";
import { setDevRolePasswords } from "../src/db/dev-roles.js";

export default async function setup(): Promise<void> {
  try { process.loadEnvFile(".env"); } catch { /* CI provides env */ }
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error("TEST_ADMIN_DATABASE_URL is required (see apps/api/.env.example)");
  const dbName = new URL(adminUrl).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset database "${dbName}": TEST_ADMIN_DATABASE_URL must point to a database ending in _test`);
  }
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await sql.unsafe("DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await sql.end();
  await runMigrations(adminUrl);
  await setDevRolePasswords(adminUrl);
}
