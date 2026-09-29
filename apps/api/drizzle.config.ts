import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  schemaFilter: ["app"],
  dbCredentials: { url: process.env.MIGRATOR_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/bytesac_dev" },
});
