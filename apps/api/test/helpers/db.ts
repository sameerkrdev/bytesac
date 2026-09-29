import postgres from "postgres";
import { createDb } from "../../src/db/client.js";

try { process.loadEnvFile(".env"); } catch { /* CI */ }

export const adminSql = postgres(process.env.TEST_ADMIN_DATABASE_URL ?? "", { max: 2, onnotice: () => undefined });
export const testDb = createDb(process.env.TEST_DATABASE_URL ?? "", { max: 8 });

const TABLES = [
  "audit_events", "contact_verifications", "contacts", "notification_preferences", "wallet_addresses",
  "auth_challenges", "sessions", "investment_wallets", "users",
];

export async function resetDb(): Promise<void> {
  await adminSql.unsafe(`TRUNCATE ${TABLES.map((t) => `app.${t}`).join(", ")} CASCADE`);
}
