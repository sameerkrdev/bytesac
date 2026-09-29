import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadDotEnvIfPresent } from "../config/env.js";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotEnvIfPresent();
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is required");
  await runMigrations(url);
  console.log("migrations applied");
}
