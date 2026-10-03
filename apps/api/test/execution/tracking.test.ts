import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { lifi } from "@/providers/routes/lifi";
import { opsUser } from "../modules/manager-applications/helpers";
import { connection } from "@/providers/solana-tx";
import { trackLeg, trackStaleClaims } from "@/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "./chain-mocks";
import { seedBasket, seedPosition, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const TKN: SeedAsset = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", bps: 5000 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000 };
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

interface LegSpec { kind?: string; status: string; toIndex?: number; fromChain?: string; toChain?: string; amountIn?: string; sourceTx?: string | null; submittedMinutesAgo?: number; fromIndex?: number }

/** An invest or sell operation with the given legs (sequence by position), inserted directly. */
async function seed(legSpecs: LegSpec[], over: { kind?: "invest" | "sell_to_usdc"; holding?: bigint; native?: boolean } = {}) {
  const chain = mockChains();
  const basket = await seedBasket({ assets: [SOL, over.native ? ETH : TKN] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  const positionId = over.holding ? await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: over.holding }]) : null;
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, amount_usdc, sell_percent, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
    VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, ${positionId}, ${over.kind ?? "invest"}, 'IN_PROGRESS', 1000000000, ${over.kind === "sell_to_usdc" ? 100 : null}, 100, 182400, ${basket.versionId}, 'key-12345678', now() + interval '30 minutes') RETURNING id`;
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
    chain.lifiStatus.set("sig-bridge", { state: "DONE", destinationTx: "0xdest" });
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
    chain.lifiStatus.set("sig-b", { state: "DONE", destinationTx: "0xdest" });
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
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[0], recheck: 1 } }); // I1: it is re-checked, not forgotten
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

describe("review fixes: tracking", () => {
  it("I1: a dropped Solana transaction (blockhash expired, never landed) fails the leg instead of locking the user out", async () => {
    const { chain, opId, ids } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "UNKNOWN", toIndex: 0, sourceTx: "sig-dropped", submittedMinutesAgo: 90 }]);
    chain.solanaFinality.set("sig-dropped", "expired");
    await trackLeg(ids[1]!, 1);
    expect(await legRow(ids[1]!)).toMatchObject({ status: "FAILED" });
    expect((await legRow(ids[1]!)).failure_reason).toMatch(/blockhash expired/);
    expect((await opStatus(opId)).status).toBe("FAILED");
    expect(fakes.queue.jobs.filter((j) => j.name === "track-leg")).toHaveLength(0);
  });

  it("I1: a recheck never throws: a provider error still schedules the next recheck and a stale leg still becomes UNKNOWN", async () => {
    const { chain, ids } = await seed([{ kind: "cross_chain", status: "PENDING_CHAIN", toChain: "ethereum", toIndex: 1, sourceTx: "sig-b", submittedMinutesAgo: 45 }]);
    chain.solanaFinality.set("sig-b", "finalized");
    vi.spyOn(lifi, "status").mockRejectedValue(new Error("LI.FI INVALID"));
    await expect(trackLeg(ids[0]!, 1)).resolves.toBeUndefined();
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[0], recheck: 2 } });
    expect((await legRow(ids[0]!)).status).toBe("UNKNOWN");
    await expect(trackLeg(ids[0]!)).rejects.toThrow(); // the first window still throws, so BullMQ backs off
  });

  it("I7/D7: an ERC-20 delivery whose route status has no destination transaction never writes the provider's amount", async () => {
    const { chain, ids } = await seed([{ kind: "cross_chain", status: "SUBMITTED", toChain: "ethereum", toIndex: 1, sourceTx: "sig-x" }]);
    chain.solanaFinality.set("sig-x", "finalized");
    chain.lifiStatus.set("sig-x", { state: "DONE", destinationTx: null });
    await expect(trackLeg(ids[0]!)).rejects.toThrow("not final");
    expect(await ledger()).toHaveLength(0);
    expect((await legRow(ids[0]!)).amount_received).toBeNull();
  });

  it("D7: a bridged native EVM asset is credited from the balance change at the destination block, or stays unsettled", async () => {
    const { chain, user, ids } = await seed([{ kind: "cross_chain", status: "SUBMITTED", toChain: "ethereum", toIndex: 1, sourceTx: "sig-n" }], { native: true });
    chain.solanaFinality.set("sig-n", "finalized");
    chain.lifiStatus.set("sig-n", { state: "DONE", destinationTx: "0xnative" });
    fakes.evm.receipts.set("0xnative", { success: true, blockNumber: 1n, head: 100n, logs: [] });
    await expect(trackLeg(ids[0]!)).rejects.toThrow("not final"); // no evidence of the amount yet
    expect(await ledger()).toHaveLength(0);
    fakes.evm.nativeReceived.set(`0xnative:${user.evmAddress}`, 7_000n);
    await trackLeg(ids[0]!);
    expect(await legRow(ids[0]!)).toMatchObject({ status: "SETTLED", amount_received: "7000", destination_tx: "0xnative" });
  });

  it("minor 3: a LI.FI PARTIAL (a different token was delivered) is UNKNOWN for a person, not FAILED", async () => {
    const { chain, ids } = await seed([{ kind: "cross_chain", status: "SUBMITTED", toChain: "ethereum", toIndex: 1, sourceTx: "sig-p" }]);
    chain.solanaFinality.set("sig-p", "finalized");
    chain.lifiStatus.set("sig-p", { state: "UNKNOWN", reason: "different token" });
    await trackLeg(ids[0]!);
    expect((await legRow(ids[0]!)).status).toBe("UNKNOWN");
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[0], recheck: 1 } });
  });

  it("I2: a claim never confirmed as sent (crash) is handed to the tracker by the sweep and followed like a submitted leg", async () => {
    const { chain, ids } = await seed([{ status: "SUBMITTING", toIndex: 0, sourceTx: "sig-c", submittedMinutesAgo: 5 }]);
    await adminSql`UPDATE app.operation_legs SET updated_at = now() - interval '5 minutes'`;
    await trackStaleClaims();
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[0] } });
    chain.solanaFinality.set("sig-c", "expired");
    await trackLeg(ids[0]!);
    expect((await legRow(ids[0]!)).status).toBe("FAILED");
  });
});

describe("N3: legs whose tracking job is gone", () => {
  it("the sweep turns a SUBMITTED leg past the window into UNKNOWN (so the user can stop and ops can resolve) and restarts the recheck chain", async () => {
    const { ids, opId, user } = await seed([{ kind: "network_fee", status: "SETTLED" }, { status: "SUBMITTED", toIndex: 0, sourceTx: "sig-orphan", submittedMinutesAgo: 40 }]);
    await trackStaleClaims();
    expect((await legRow(ids[1]!)).status).toBe("UNKNOWN");
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: ids[1], recheck: 2 } });
    const stop = await request(app).post(`/v1/operations/${opId}/cancel`).set(user.h);
    expect(stop.status).toBe(200);
    expect(stop.body.status).toBe("PARTIAL");
  });

  it("a recent SUBMITTED leg is left to its own job", async () => {
    const { ids } = await seed([{ status: "SUBMITTED", toIndex: 0, sourceTx: "sig-fresh", submittedMinutesAgo: 5 }]);
    await trackStaleClaims();
    expect((await legRow(ids[0]!)).status).toBe("SUBMITTED");
  });
});

describe("ops resolve tool (D2)", () => {
  const resolve = (h: Record<string, string>, opId: string, legId: string, body: object) => request(app).post(`/v1/ops/operations/${opId}/legs/${legId}/resolve`).set(h).send(body);
  const base = { txEvidence: "0xevidence000", reason: "Verified on the explorer by ops." };

  it("is for ops_admin only", async () => {
    const { opId, ids } = await seed([{ status: "UNKNOWN", toIndex: 0, sourceTx: "sig-1" }]);
    const reviewer = await opsUser(app, "ops_reviewer");
    expect((await resolve(reviewer.h, opId, ids[0]!, { ...base, status: "FAILED" })).status).toBe(403);
  });

  it("settles from chain evidence the server reads itself, writes the ledger and audits it; the supplied amount must match the chain", async () => {
    const { chain, user, opId, ids } = await seed([{ kind: "cross_chain", status: "UNKNOWN", toChain: "ethereum", toIndex: 1, sourceTx: "0xreplaced" }]);
    const admin = await opsUser(app, "ops_admin");
    const token = (await adminSql<{ address: string }[]>`SELECT address FROM app.instrument_deployments WHERE chain = 'ethereum'`)[0]!.address;
    fakes.evm.receipts.set("0xnewhash", { success: true, blockNumber: 1n, head: 100n, logs: [{ address: token, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(user.evmAddress)], data: "0x" + (9_000n).toString(16) }] });
    const wrong = await resolve(admin.h, opId, ids[0]!, { ...base, txEvidence: "0xnewhash", status: "SETTLED", amountReceived: "1" });
    expect(wrong.status).toBe(409);
    expect(await ledger()).toHaveLength(0);
    const ok = await resolve(admin.h, opId, ids[0]!, { ...base, txEvidence: "0xnewhash", status: "SETTLED", amountReceived: "9000" });
    expect(ok.status).toBe(200);
    expect(await legRow(ids[0]!)).toMatchObject({ status: "SETTLED", amount_received: "9000", destination_tx: "0xnewhash" });
    expect(await ledger()).toEqual([expect.objectContaining({ quantity_delta: "9000", reason: "invest" })]);
    expect((await opStatus(opId)).status).toBe("COMPLETED");
    expect(await adminSql`SELECT metadata FROM app.audit_events WHERE action = 'leg.resolved_by_ops'`).toEqual([{ metadata: expect.objectContaining({ status: "SETTLED", verifiedOnChain: true, txEvidence: "0xnewhash" }) }]);
    expect((await resolve(admin.h, opId, ids[0]!, { ...base, status: "FAILED" })).status).toBe(409); // no longer UNKNOWN
    void chain;
  });

  it("refuses SETTLED without final on-chain evidence, and FAILED against a finalized same-chain transaction", async () => {
    const { chain, opId, ids } = await seed([{ status: "UNKNOWN", toIndex: 0, sourceTx: "sig-fin" }]);
    const admin = await opsUser(app, "ops_admin");
    expect((await resolve(admin.h, opId, ids[0]!, { ...base, txEvidence: "sig-nothing", status: "SETTLED", amountReceived: "5" })).status).toBe(409);
    chain.solanaFinality.set("sig-fin", "finalized");
    expect((await resolve(admin.h, opId, ids[0]!, { ...base, status: "FAILED" })).status).toBe(409);
    chain.solanaFinality.set("sig-fin", "pending");
    const failed = await resolve(admin.h, opId, ids[0]!, { ...base, status: "FAILED" });
    expect(failed.status).toBe(200);
    expect((await legRow(ids[0]!)).failure_reason).toMatch(/Resolved by ops/);
    expect(await ledger()).toHaveLength(0);
  });
});
