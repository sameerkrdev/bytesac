import { eq } from "drizzle-orm";
import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { investmentWallets, users, walletAddresses } from "@repo/db";
import { isUniqueViolation } from "../../src/shared/pg-errors.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
beforeEach(resetDb);

async function newUser() {
  const [u] = await db.insert(users).values({ status: "active" }).returning();
  return u!;
}

describe("database access model", () => {
  it("every app table has RLS enabled", async () => {
    const rows = await adminSql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("runtime role cannot delete or run DDL, and cannot modify audit rows", async () => {
    const api = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => undefined });
    try {
      await expect(api`DELETE FROM app.users`).rejects.toThrow(/permission denied/);
      await expect(api`CREATE TABLE app.x (id int)`).rejects.toThrow(/permission denied/);
      await expect(api`UPDATE app.audit_events SET action = 'x'`).rejects.toThrow(/permission denied/);
    } finally { await api.end(); }
  });

  it("Supabase client roles cannot read app tables", async () => {
    await expect(adminSql.begin(async (tx) => { await tx`SET LOCAL ROLE anon`; return tx`SELECT * FROM app.users`; })).rejects.toThrow(/permission denied/);
    await expect(adminSql.begin(async (tx) => { await tx`SET LOCAL ROLE authenticated`; return tx`SELECT * FROM app.sessions`; })).rejects.toThrow(/permission denied/);
  });
});

describe("identity invariants", () => {
  it("one active investment wallet per user, enforced under concurrency", async () => {
    const u = await newUser();
    const results = await Promise.allSettled([1, 2, 3].map(() => db.insert(investmentWallets).values({ userId: u.id, status: "active" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(isUniqueViolation(rejected.reason, "investment_wallets_one_active_per_user")).toBe(true);
  });

  it("(chain, address) is globally unique", async () => {
    const a = await newUser();
    const b = await newUser();
    const [wa] = await db.insert(investmentWallets).values({ userId: a.id, status: "active" }).returning();
    const [wb] = await db.insert(investmentWallets).values({ userId: b.id, status: "active" }).returning();
    const row = { chainFamily: "evm" as const, chain: "base" as const, address: "0xabc", verificationMethod: "eoa_ecdsa" as const, verifiedOnChain: "base" as const };
    await db.insert(walletAddresses).values({ ...row, investmentWalletId: wa!.id });
    const err = await db.insert(walletAddresses).values({ ...row, investmentWalletId: wb!.id }).catch((e: unknown) => e);
    expect(isUniqueViolation(err, "wallet_addresses_chain_address_key")).toBe(true);
    expect(await db.select().from(walletAddresses).where(eq(walletAddresses.chain, "base"))).toHaveLength(1);
  });

  it("chain/family/method consistency is checked", async () => {
    const u = await newUser();
    const [w] = await db.insert(investmentWallets).values({ userId: u.id, status: "active" }).returning();
    await expect(db.insert(walletAddresses).values({
      investmentWalletId: w!.id, chainFamily: "evm", chain: "solana", address: "x", verificationMethod: "eoa_ecdsa", verifiedOnChain: "solana",
    })).rejects.toThrow();
  });
});
