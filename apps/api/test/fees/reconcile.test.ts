import { PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@repo/logger";
import { connection } from "../../src/providers/solana-tx";
import { reconcileRevenue } from "../../src/services/fees";
import { adminSql, resetDb } from "../helpers/db";
import { USDC_MINT, seedBasket } from "../execution/helpers";
import { seedLeg } from "../execution/helpers";
import { solanaTestWallet } from "../execution/chain-mocks";

// The revenue treasury address is switchable per test (the parsed env is read-only).
const revenue = vi.hoisted(() => ({ address: "" }));
vi.mock("../../src/env", async (original) => {
  const m = await original<typeof import("../../src/env")>();
  return { ...m, env: new Proxy({} as typeof m.env, { get: (_, k) => (k === "REVENUE_TREASURY_SOLANA_ADDRESS" ? revenue.address : Reflect.get(m.env, k)) }) };
});

const DAY = "2026-09-10";
const at = (hour: number) => Date.parse(`${DAY}T${String(hour).padStart(2, "0")}:00:00Z`) / 1000;
const parsed = (owner: string, pre: string, post: string) => ({ meta: { err: null, preTokenBalances: [{ owner, mint: USDC_MINT, uiTokenAmount: { amount: pre } }], postTokenBalances: [{ owner, mint: USDC_MINT, uiTokenAmount: { amount: post } }] } });

async function settledPlatformFee(amount: bigint, settledAt: string) {
  const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
  const { legId, operationId } = await seedLeg(basket.ownerId, basket, { kind: "network_fee" });
  await adminSql`INSERT INTO app.operation_fees (id, operation_id, leg_id, kind, base_micro, amount_micro, settled_at) VALUES (gen_random_uuid(), ${operationId}, ${legId}, 'platform', 100000000, ${amount.toString()}, ${settledAt})`;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await resetDb();
  revenue.address = solanaTestWallet().address;
  warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
  vi.spyOn(logger, "info").mockImplementation(() => logger);
});
afterEach(() => vi.restoreAllMocks());

/** The treasury's token account history for the day: two inflows inside it, one just before it, one failed. */
function chain(inflows: Record<string, string>) {
  const sigs = vi.spyOn(connection, "getSignaturesForAddress").mockResolvedValue([
    { signature: "late", slot: 4, err: null, memo: null, blockTime: at(23) },
    { signature: "failed", slot: 3, err: { InstructionError: [0, "Custom"] }, memo: null, blockTime: at(12) },
    { signature: "early", slot: 2, err: null, memo: null, blockTime: at(2) },
    { signature: "yesterday", slot: 1, err: null, memo: null, blockTime: at(-2) },
  ]);
  const owner = revenue.address;
  const txs = vi.spyOn(connection, "getParsedTransactions").mockImplementation(async (list) => list.map((s) => parsed(owner, "1000000", String(1_000_000n + BigInt(inflows[s] ?? "0"))) as never));
  return { sigs, txs };
}

describe("revenue reconciliation", () => {
  it("equal totals: no warning; only the day's successful signatures are fetched, for the treasury's USDC token account", async () => {
    await settledPlatformFee(2_000_000n, `${DAY}T10:00:00Z`);
    await settledPlatformFee(500_000n, `${DAY}T20:00:00Z`);
    await settledPlatformFee(9_000_000n, "2026-09-11T01:00:00Z"); // another day
    const { sigs, txs } = chain({ early: "2000000", late: "500000", yesterday: "99999999" });
    await reconcileRevenue(DAY);
    expect(warn).not.toHaveBeenCalled();
    expect(txs.mock.calls.flatMap((c) => c[0])).toEqual(["late", "early"]);
    const ata = PublicKey.findProgramAddressSync([new PublicKey(revenue.address).toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), new PublicKey(USDC_MINT).toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
    expect((sigs.mock.calls[0]![0] as PublicKey).equals(ata)).toBe(true);
  });

  it("different totals: warns with both", async () => {
    await settledPlatformFee(2_000_000n, `${DAY}T10:00:00Z`);
    chain({ early: "1500000" });
    await reconcileRevenue(DAY);
    expect(warn).toHaveBeenCalledWith("revenue reconciliation mismatch", { day: DAY, settledMicro: "2000000", onChainMicro: "1500000" });
  });

  it("an RPC failure is a warning, not an error", async () => {
    await settledPlatformFee(2_000_000n, `${DAY}T10:00:00Z`);
    vi.spyOn(connection, "getSignaturesForAddress").mockRejectedValue(new Error("rpc down"));
    await expect(reconcileRevenue(DAY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("revenue reconciliation failed", expect.objectContaining({ day: DAY, errMessage: "rpc down" }));
  });

  it("without a revenue treasury there is nothing to reconcile", async () => {
    revenue.address = "";
    const sigs = vi.spyOn(connection, "getSignaturesForAddress");
    await reconcileRevenue(DAY);
    expect(sigs).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
