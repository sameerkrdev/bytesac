import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@repo/db";
import { feePayer } from "../../src/providers/solana-tx";
import { platformAddress, reserveGas, seedPlatformWallets, sendGasDrop } from "../../src/services/gas";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { seedBasket, seedLeg, seedUser } from "./helpers";

const ETH = 10n ** 18n;
const USER_CAP = ETH / 500n; // 0.002 ETH
const GLOBAL_CAP = (ETH * 2n) / 25n; // 0.08 ETH
const reserve = (userId: string, amountNative: bigint, chain: "ethereum" | "solana" = "ethereum") => db.transaction((tx) => reserveGas(tx, { userId, chain, amountNative }));
const usage = async (userId: string) => BigInt((await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${userId}`)[0]?.amount_native ?? "0");

beforeEach(resetDb);

describe("platform wallets", () => {
  it("seeds public addresses from the env-derived keys", async () => {
    await seedPlatformWallets();
    await seedPlatformWallets(); // idempotent
    expect(await platformAddress("solana", "solana_fee_payer")).toBe(feePayer().publicKey.toBase58());
    expect(await platformAddress("base", "evm_gas")).toBe(fakes.evm.gasWalletAddress());
    expect(await platformAddress("solana", "gas_treasury")).toBeTruthy();
    expect(await adminSql`SELECT 1 FROM app.platform_wallets`).toHaveLength(7);
  });
  it("is a route error when a wallet is not configured", async () => {
    await expect(platformAddress("solana", "solana_fee_payer")).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });
});

describe("gas budgets", () => {
  it("enforces the per-user daily cap and rolls the refused reservation back", async () => {
    const u = await seedUser();
    await reserve(u.userId, (USER_CAP * 3n) / 4n);
    await expect(reserve(u.userId, USER_CAP / 2n)).rejects.toMatchObject({ code: "GAS_BUDGET_EXHAUSTED", status: 409 });
    expect(await usage(u.userId)).toBe((USER_CAP * 3n) / 4n);
    await reserve(u.userId, USER_CAP / 4n); // exactly to the cap
    expect(await usage(u.userId)).toBe(USER_CAP);
    await reserve((await seedUser()).userId, USER_CAP); // another user is unaffected
  });

  it("counts chains separately", async () => {
    const u = await seedUser();
    await reserve(u.userId, USER_CAP);
    await reserve(u.userId, 20_000_000n, "solana");
    await expect(reserve(u.userId, 1n, "solana")).rejects.toMatchObject({ code: "GAS_BUDGET_EXHAUSTED" });
  });

  it("enforces the global cap under concurrency: of two parallel reservations near the cap only one passes (Review Focus 5)", async () => {
    const [a, b, filler] = [await seedUser(), await seedUser(), await seedUser()];
    await adminSql`INSERT INTO app.sponsor_usage (user_id, chain, day, amount_native) VALUES (${filler.userId}, 'ethereum', (now() at time zone 'utc')::date, ${(GLOBAL_CAP - 500_000n).toString()})`;
    const results = await Promise.allSettled([reserve(a.userId, 300_000n), reserve(b.userId, 300_000n)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: "GAS_BUDGET_EXHAUSTED" }) })]);
    expect((await usage(a.userId)) + (await usage(b.userId))).toBe(300_000n);
  });
});

describe("EVM gas drops", () => {
  const setup = async () => {
    const basket = await seedBasket({ assets: [{ symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 10_000 }] });
    const user = await seedUser();
    const { legId } = await seedLeg(user.userId, basket);
    return { user, legId };
  };
  const drops = () => adminSql<{ status: string; tx_hash: string | null; amount_native: string }[]>`SELECT status, tx_hash, amount_native FROM app.gas_drops`;

  it("skips the drop when the recipient already holds enough native gas", async () => {
    const { user, legId } = await setup();
    fakes.evm.balances.set(`ethereum:${user.evmAddress}`, 1_000_000n);
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "skipped", txHash: null });
    expect(fakes.evm.sentNative).toHaveLength(0);
    expect(await drops()).toHaveLength(0);
  });

  it("records the drop, sends exactly the computed amount once, then confirms it from the receipt", async () => {
    const { user, legId } = await setup();
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "pending", txHash: "0xdrop1" });
    expect(fakes.evm.sentNative).toEqual([{ chain: "ethereum", to: user.evmAddress, value: 900_000n }]);
    expect(await drops()).toEqual([{ status: "pending", tx_hash: "0xdrop1", amount_native: "900000" }]);
    expect(await usage(user.userId)).toBe(900_000n);
    // not mined yet: still pending, and nothing is sent again
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "pending", txHash: "0xdrop1" });
    fakes.evm.receipts.set("0xdrop1", { success: true, blockNumber: 1n, head: 2n, logs: [] });
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "confirmed", txHash: "0xdrop1" });
    expect(fakes.evm.sentNative).toHaveLength(1);
    expect(await adminSql`SELECT action FROM app.audit_events WHERE entity_type = 'gas_drop' ORDER BY created_at`).toHaveLength(3);
  });

  it("refuses over budget before anything is recorded or sent", async () => {
    const { user, legId } = await setup();
    await expect(sendGasDrop(legId, "ethereum", user.evmAddress, USER_CAP + 1n)).rejects.toMatchObject({ code: "GAS_BUDGET_EXHAUSTED" });
    expect(await drops()).toHaveLength(0);
    expect(fakes.evm.sentNative).toHaveLength(0);
  });

  it("a node's definitive refusal is a failed drop, not an unknown outcome; the next call reports it and sends nothing", async () => {
    const { user, legId } = await setup();
    fakes.evm.sendRefused = true;
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "failed", txHash: null });
    fakes.evm.sendRefused = false;
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "failed", txHash: null });
    expect(await drops()).toEqual([{ status: "failed", tx_hash: null, amount_native: "900000" }]);
  });

  it("D3: at most 5 drops per user per chain per day, even when each is within the budget", async () => {
    const basket = await seedBasket({ assets: [{ symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 10_000 }] });
    const user = await seedUser();
    for (let n = 0; n < 5; n++) {
      const { legId } = await seedLeg(user.userId, basket);
      await adminSql`UPDATE app.operations SET status = 'CANCELLED' WHERE user_id = ${user.userId}`; // free the one-active slot for the next seeded operation
      await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${legId}`;
      await adminSql`INSERT INTO app.gas_drops (id, leg_id, chain, recipient, amount_native, status) VALUES (gen_random_uuid(), ${legId}, 'ethereum', ${user.evmAddress}, 1, 'confirmed')`;
    }
    const { legId } = await seedLeg(user.userId, basket);
    await expect(sendGasDrop(legId, "ethereum", user.evmAddress, 1_000n)).rejects.toMatchObject({ code: "GAS_BUDGET_EXHAUSTED" });
    expect(fakes.evm.sentNative).toHaveLength(0);
    await expect(sendGasDrop(legId, "base", user.evmAddress, 1_000n)).resolves.toMatchObject({ status: "pending" }); // another chain has its own count
  });

  it("I8: skips only when the balance covers the gas AND the amount the leg itself sends (selling the native asset)", async () => {
    const { user, legId } = await setup();
    fakes.evm.balances.set(`ethereum:${user.evmAddress}`, 1_000_000n);
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n, 500_000n)).toMatchObject({ status: "pending", txHash: "0xdrop1" });
  });

  it("never sends again when the first send's outcome is unknown", async () => {
    const { user, legId } = await setup();
    fakes.evm.sendFails = true;
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "pending", txHash: null });
    fakes.evm.sendFails = false;
    expect(await sendGasDrop(legId, "ethereum", user.evmAddress, 900_000n)).toEqual({ status: "pending", txHash: null });
    expect(fakes.evm.sentNative).toHaveLength(0);
    expect(await drops()).toHaveLength(1);
  });
});
