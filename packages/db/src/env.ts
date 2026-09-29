import { cleanEnv, url } from "envalid";

export const env = cleanEnv(process.env, {
  DATABASE_URL: url({ desc: "Runtime Postgres connection (least-privilege bytesac_api role)", example: "postgres://bytesac_api:secret@localhost:54329/bytesac_dev" }),
});
