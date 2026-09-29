import { defineConfig } from "drizzle-kit";
import { cleanEnv, url } from "envalid";

const env = cleanEnv(process.env, {
  MIGRATOR_DATABASE_URL: url({ default: "postgres://postgres:postgres@localhost:54329/bytesac_dev" }),
});

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["app"],
  dbCredentials: { url: env.MIGRATOR_DATABASE_URL },
});
