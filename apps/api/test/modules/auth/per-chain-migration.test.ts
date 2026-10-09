import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { investmentWallets, users, walletAddresses } from "@repo/db";
import { backfillPolygon } from "@/modules/auth/wallets.service";
import { adminSql, resetDb, testDb } from "../../helpers/db";

const db = testDb.db;
beforeEach(resetDb);

async function wallet(addr: string, method: "eoa_ecdsa" | "erc1271", polygon = false) {
  const [u] = await db.insert(users).values({ status: "active" }).returning();
  const [w] = await db.insert(investmentWallets).values({ userId: u!.id, status: "active" }).returning();
  const base = { investmentWalletId: w!.id, chainFamily: "evm" as const, verificationMethod: method, verifiedOnChain: "base" as const };
  const chains: ("ethereum" | "base" | "polygon")[] = polygon ? ["ethereum", "base", "polygon"] : ["ethereum", "base"];
  for (const chain of chains) await db.insert(walletAddresses).values({ ...base, chain, address: addr });
  return w!.id;
}
const polygonRows = (walletId: string) => db.select().from(walletAddresses).where(and(eq(walletAddresses.investmentWalletId, walletId), eq(walletAddresses.chain, "polygon")));

describe("per-chain schema", () => {
  it("has the active-chain unique index and accepts polygon", async () => {
    const idx = await adminSql`select indexdef from pg_indexes where indexname = 'wallet_addresses_active_chain_key'`;
    expect(idx[0]?.indexdef).toContain("WHERE (status = 'active'");
    const enumVals = await adminSql`select unnest(enum_range(null::app.chain))::text as v`;
    expect(enumVals.map((r) => r.v)).toContain("polygon");
  });
});

describe("backfillPolygon", () => {
  it("adds one polygon row for EOA wallets only, is idempotent, and leaves existing polygon rows alone", async () => {
    const eoa = await wallet("0x" + "a".repeat(40), "eoa_ecdsa");
    const smart = await wallet("0x" + "b".repeat(40), "erc1271");
    const has = await wallet("0x" + "c".repeat(40), "eoa_ecdsa", true);
    const before = await polygonRows(has);
    expect(await backfillPolygon(db)).toBe(1);
    const rows = await polygonRows(eoa);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ address: "0x" + "a".repeat(40), status: "active", chainFamily: "evm" });
    expect(await polygonRows(smart)).toHaveLength(0);
    expect(await polygonRows(has)).toEqual(before);
    expect(await backfillPolygon(db)).toBe(0);
    expect(await polygonRows(eoa)).toHaveLength(1);
  });

  it("gives a wallet with different EVM addresses per chain one polygon row, from its earliest address", async () => {
    const [u] = await db.insert(users).values({ status: "active" }).returning();
    const [w] = await db.insert(investmentWallets).values({ userId: u!.id, status: "active" }).returning();
    const base = { investmentWalletId: w!.id, chainFamily: "evm" as const, verificationMethod: "eoa_ecdsa" as const, verifiedOnChain: "base" as const };
    await db.insert(walletAddresses).values({ ...base, chain: "ethereum", address: "0x" + "d".repeat(40), createdAt: new Date("2026-01-01") });
    await db.insert(walletAddresses).values({ ...base, chain: "base", address: "0x" + "e".repeat(40), createdAt: new Date("2026-02-01") });
    expect(await backfillPolygon(db)).toBe(1);
    const rows = await polygonRows(w!.id);
    expect(rows.map((r) => r.address)).toEqual(["0x" + "d".repeat(40)]);
  });
});
