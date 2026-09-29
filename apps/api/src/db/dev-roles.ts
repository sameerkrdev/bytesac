// dev-roles.ts — local/test only: enable LOGIN with fixed dev passwords.
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadDotEnvIfPresent } from "../config/env.js";

export async function setDevRolePasswords(adminUrl: string): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("dev-roles must never run in production");
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe("ALTER ROLE bytesac_api LOGIN PASSWORD 'bytesac_api_dev'");
    await sql.unsafe("ALTER ROLE bytesac_retention LOGIN PASSWORD 'bytesac_retention_dev'");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnvIfPresent();
  if (process.env.NODE_ENV === "production") throw new Error("dev-roles must never run in production");
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is required");
  await setDevRolePasswords(url);
  console.log("dev role passwords set");
}
