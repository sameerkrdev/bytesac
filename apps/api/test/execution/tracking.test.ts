import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connection } from "../../src/providers/solana-tx";
import { trackLeg } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "./chain-mocks";
import { seedBasket, seedPosition, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const TKN: SeedAsset = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", bps: 5000 };
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

interface LegSpec { kind?: string; status: string; toIndex?: number; fromChain?: string; toChain?: string; amountIn?: string; sourceTx?: string | null; submittedMinutesAgo?: number; fromIndex?: number }

/** An invest or sell operation with the given legs (sequence by position), inserted directly. */
async function seed(legSpecs: LegSpec[], over: { kind?: "invest" | "sell_to_usdc"; holding?: bigint } = {}) {
  const chain = mockChains();
  const basket = await seedBasket({ assets: [SOL, TKN] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  const positionId = over.holding ? await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: over.holding }]) : null;
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, amount_usdc, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
    VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, ${positionId}, ${over.kind ?? "invest"}, 'IN_PROGRESS', 1000000000, 100, 182400, ${basket.versionId}, 'key-12345678', now() + interval '30 minutes') RETURNING id`;
  const ids: string[] = [];
  for (const [n, l] of legSpecs.entries()) {
    const [leg] = await adminSql<{ id: string }[]>`
      INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, from_deployment_id, to_chain, to_deployment_id, amount_in, provider, status, source_tx, submitted_at)
      VALUES (gen_random_uuid(), ${op!.id}, ${n + 1}, ${l.kind ?? "swap"}, ${l.fromChain ?? "solana"}, ${l.fromIndex === undefined ? null : basket.deployments[l.fromIndex]!.deploymentId}, ${l.toChain ?? "solana"},
        ${l.toIndex === undefined ? null : basket.deployments[l.toIndex]!.deploymentId}, ${l.amountIn ?? "1000000"}, ${l.kind === "network_fee" ? null : "lifi"}, ${l.status}, ${l.sourceTx ?? null},
        ${l.status === "PLANNED" ? null : adminSql`now() - ${(l.submittedMinutesAgo ?? 0) + " minutes"}::interval`}) RETURNING id`;
    ids.push(leg!.id);
  }
  return { chain, basket, user, opId: op!.id, ids };
}
const legRow = async (id: string) => (await adminSql<{ status: string; amount_received: string | null; destination_tx: string | null; failure_reason: string | null; unknown_since: Date | null }[]>`SELECT * FROM app.operation_legs WHERE id = ${id}`)[0]!;
const opStatus = async (id: string) => (await adminSql<{ status: string; position_id: string | null }[]>`SELECT status, position_id FROM app.operations WHERE id = ${id}`)[0]!;
const ledger = () => adminSql<{ quantity_delta: string; reason: string; deployment_id: string }[]>`SELECT quantity_delta, reason, deployment_id FROM app.position_ledger_entries ORDER BY created_at`;
const sends = () => vi.mocked(connection.sendRawTransaction).mock.calls.length;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("track-leg", () => {
  it("settles a swap with what actually arrived: ledger entry, a position, and the operation stays open until every leg settled", async () => {
    const { chain, user, basket, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "SUBMITTED", toIndex: 0, sourceTx: "sig-swap" }, { kind: "cross_chain", status: "PLANNED", toChain: "ethereum", toIndex: 1 }]);
    chain.solanaFinality.set("sig-swap", "finalized");
    chain.solanaReceived.set(`sig-swap:${user.solanaAddress}`, 123_456n);
    await trackLeg(ids[1]!);
    expect(await legRow(ids[1]!)).toMatchObject({ status: "SETTLED", amount_received: "123456", destination_tx: "sig-swap" });
    expect(await ledger()).toEqual([{ quantity_delta: "123456", reason: "invest", deployment_id: basket.deployments[0]!.deploymentId }]);
    const op = await opStatus(opId);
    expect(op.status).toBe("IN_PROGRESS");
    expect(op.position_id).toBeTruthy();
    expect(await adminSql`SELECT status FROM app.basket_positions WHERE id = ${op.position_id}`).toEqual([{ status: "OPEN" }]);
    await trackLeg(ids[1]!); // idempotent: a settled leg is left alone
    expect(await ledger()).toHaveLength(1);
  });

  it("settles a cross-chain leg from the route status and the ERC-20 Transfer logs, then completes the operation", async () => {
    const { chain, user, basket, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { kind: "cross_chain", status: "PENDING_CHAIN", toChain: "ethereum", toIndex: 1, sourceTx: "sig-bridge" }]);
    const token = basket.deployments[1]!.address!;
    chain.solanaFinality.set("sig-bridge", "finalized");
    chain.lifiStatus.set("sig-bridge", { state: "DONE", destinationTx: "0xdest", receivedAmount: 999n });
    fakes.evm.receipts.set("0xdest", { success: true, blockNumber: 100n, head: 120n, logs: [
      { address: token, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(user.evmAddress)], data: "0x" + (5_000_000n).toString(16) },
      { address: token, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad("0x" + "33".repeat(20))], data: "0x" + (777n).toString(16) }, // someone else's
    ] });
    await trackLeg(ids[1]!);
    expect(await legRow(ids[1]!)).toMatchObject({ status: "SETTLED", amount_received: "5000000", destination_tx: "0xdest" });
    expect((await opStatus(opId)).status).toBe("COMPLETED");
  });

  it("waits for destination confirmations (Ethereum 12)", async () => {
    const { chain, user, basket, ids } = await seed([{ kind: "cross_chain", status: "SUBMITTED", toChain: "ethereum", toIndex: 1, sourceTx: "sig-b" }]);
    chain.solanaFinality.set("sig-b", "finalized");
    chain.lifiStatus.set("sig-b", { state: "DONE", destinationTx: "0xdest", receivedAmount: null });
    fakes.evm.receipts.set("0xdest", { success: true, blockNumber: 100n, head: 105n, logs: [{ address: basket.deployments[1]!.address!, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(user.evmAddress)], data: "0x01" }] });
    await expect(trackLeg(ids[0]!)).rejects.toThrow("not final");
    expect((await legRow(ids[0]!)).status).toBe("PENDING_CHAIN");
  });

  it("a failed source transaction fails the leg, and the operation FAILED when nothing settled", async () => {
    const { chain, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "SUBMITTED", toIndex: 0, sourceTx: "sig-bad" }, { kind: "cross_chain", status: "PLANNED", toChain: "ethereum", toIndex: 1 }]);
    chain.solanaFinality.set("sig-bad", "failed");
    await trackLeg(ids[1]!);
    expect(await legRow(ids[1]!)).toMatchObject({ status: "FAILED", failure_reason: "The source transaction failed." });
    expect((await opStatus(opId)).status).toBe("FAILED");
    expect(await ledger()).toHaveLength(0);
  });

  it("a provider failure after another asset leg settled leaves the operation PARTIAL", async () => {
    const { chain, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "SETTLED", toIndex: 0 }, { kind: "cross_chain", status: "SUBMITTED", toChain: "ethereum", toIndex: 1, sourceTx: "sig-x" }]);
    chain.solanaFinality.set("sig-x", "finalized");
    chain.lifiStatus.set("sig-x", { state: "FAILED", reason: "REFUNDED" });
    await trackLeg(ids[2]!);
    expect(await legRow(ids[2]!)).toMatchObject({ status: "FAILED", failure_reason: "The route failed: REFUNDED." });
    expect((await opStatus(opId)).status).toBe("PARTIAL");
  });

  it("a leg that cannot be confirmed for 30 minutes becomes UNKNOWN, is never resubmitted, and a later recheck settles it (Review Focus 2)", async () => {
    const { chain, user, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "PENDING_CHAIN", toIndex: 0, sourceTx: "sig-slow", submittedMinutesAgo: 31 }]);
    // not final yet, past the window
    await trackLeg(ids[1]!);
    const unknown = await legRow(ids[1]!);
    expect(unknown.status).toBe("UNKNOWN");
    expect(unknown.unknown_since).toBeTruthy();
    expect((await opStatus(opId)).status).toBe("IN_PROGRESS");
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[1], recheck: 1 } });
    expect(sends()).toBe(0);
    expect(chain.broadcasts).toHaveLength(0);

    // the hourly recheck: still nothing -> the next recheck is queued, nothing else changes
    await trackLeg(ids[1]!, 1);
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[1], recheck: 2 } });
    expect((await legRow(ids[1]!)).status).toBe("UNKNOWN");

    // the chain finally confirms it: UNKNOWN -> SETTLED with the ledger entry
    chain.solanaFinality.set("sig-slow", "finalized");
    chain.solanaReceived.set(`sig-slow:${user.solanaAddress}`, 42n);
    await trackLeg(ids[1]!, 2);
    expect(await legRow(ids[1]!)).toMatchObject({ status: "SETTLED", amount_received: "42" });
    expect(await ledger()).toHaveLength(1);
    expect(sends()).toBe(0);
    expect(chain.broadcasts).toHaveLength(0);
  });

  it("stops rechecking after seven days of hourly checks", async () => {
    const { ids } = await seed([{ status: "UNKNOWN", toIndex: 0, sourceTx: "sig-gone", submittedMinutesAgo: 60 * 24 * 7 }]);
    await trackLeg(ids[0]!, 168);
    expect(fakes.queue.jobs.filter((j) => j.name === "track-leg")).toHaveLength(0);
    expect((await legRow(ids[0]!)).status).toBe("UNKNOWN");
  });

  it("delivered per the provider but nothing visible for the user is UNKNOWN, not a loss", async () => {
    const { chain, user, ids } = await seed([{ status: "SUBMITTED", toIndex: 0, sourceTx: "sig-zero" }]);
    chain.solanaFinality.set("sig-zero", "finalized");
    chain.solanaReceived.set(`sig-zero:${user.solanaAddress}`, 0n);
    await trackLeg(ids[0]!);
    expect((await legRow(ids[0]!)).status).toBe("UNKNOWN");
    expect(await ledger()).toHaveLength(0);
  });

  it("a settled sell leg writes a negative ledger entry on the position's holding and the network fee writes none", async () => {
    const { chain, user, opId, ids } = await seed(
      [{ status: "SUBMITTED", fromIndex: 0, amountIn: "500", sourceTx: "sig-sell" }, { kind: "network_fee", status: "SUBMITTED", sourceTx: "sig-fee" }],
      { kind: "sell_to_usdc", holding: 1_000n },
    );
    for (const sig of ["sig-sell", "sig-fee"]) chain.solanaFinality.set(sig, "finalized");
    chain.solanaReceived.set(`sig-sell:${user.solanaAddress}`, 77_000_000n);
    await trackLeg(ids[0]!);
    await trackLeg(ids[1]!);
    expect(await ledger()).toEqual([expect.objectContaining({ quantity_delta: "1000", reason: "invest" }), { quantity_delta: "-500", reason: "sell", deployment_id: expect.any(String) }]);
    expect((await opStatus(opId)).status).toBe("COMPLETED");
    expect((await legRow(ids[0]!)).amount_received).toBe("77000000");
  });
});
