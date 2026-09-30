import postgres from "postgres";
import { setDevRolePasswords } from "./dev-roles";
import { runMigrations } from "./migrate";

/** Drops and recreates the `app` schema from the migrations. Refuses any database whose name does not end in `_test`. */
export async function resetTestDatabase(adminUrl: string): Promise<void> {
  const dbName = new URL(adminUrl).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset database "${dbName}": it must end in _test`);
  const sql = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  } finally {
    await sql.end();
  }
  await runMigrations(adminUrl);
  await setDevRolePasswords(adminUrl);
}

/** Empties every table in the `app` schema except the seeded reference data (run as the schema owner). */
export async function truncateAppTables(admin: postgres.Sql): Promise<void> {
  const tables = await admin<{ name: string }[]>`SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'app' AND tablename <> 'verification_requirement_templates'`;
  await admin.unsafe(`TRUNCATE ${tables.map((t) => t.name).join(", ")} CASCADE`);
}
