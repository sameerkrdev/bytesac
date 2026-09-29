import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "./schema";

// prepare:false is required behind Supabase's transaction-mode pooler.
export const db = drizzle(postgres(env.DATABASE_URL, { max: 10, prepare: false, onnotice: () => undefined }), { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
