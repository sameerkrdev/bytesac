// Local/test only: enable LOGIN with fixed dev passwords. `pnpm db:dev-roles` runs it against MIGRATOR_DATABASE_URL.
import { fileURLToPath } from "node:url";
import { cleanEnv, url } from "envalid";
import postgres from "postgres";

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
  const env = cleanEnv(process.env, { MIGRATOR_DATABASE_URL: url() });
  await setDevRolePasswords(env.MIGRATOR_DATABASE_URL);
  console.log("dev role passwords set");
}
