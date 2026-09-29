import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  // prepare:false is required behind Supabase's transaction-mode pooler.
  const client = postgres(url, { max: opts.max ?? 10, prepare: false, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
