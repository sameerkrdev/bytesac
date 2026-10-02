import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { lifi } from "../../src/providers/routes/lifi";
import { seedPlatformWallets } from "../../src/services/gas";
import { trackLeg } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "./chain-mocks";
import { seedBasket, seedCash, seedPosition, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const TKN: SeedAsset = { symbol: "TKN", chain: "base", tokenStandard: "erc20", bps: 5000, decimals: 6 };
const DELIVERED = "0x" + "dd".repeat(20); // USDC on Base: what arrives when the destination swap fails
const WRAPPED = "WrappedToken11111111111111111111111111111111"; // what arrives on Solana for a sell
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const EVM_TX = { to: "0x" + "ab".repeat(20), input: "0x1234", value: 0n, blockNumber: null };

type Kind = "invest" | "rebalance" | "repair" | "sell_to_usdc";
interface Row { id: string; sequence: number; kind: string; status: string; from_chain: string; to_chain: string; to_deployment_id: string | null; amount_in: string; min_out: string | null; gas_payer: string | null; recovery_of: string | null; recovery_token: Record<string, string> | null; route_summary: Record<string, unknown> | null; failure_reason: string | null; provider_substatus: string | null; amount_received: string | null; expected_tx: Record<string, unknown> | null }
const legs = (opId: string) => adminSql<Row[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;
const opRow = async (id: string) => (await adminSql<{ status: string; gas_reserved: Record<string, string> }[]>`SELECT status, gas_reserved FROM app.operations WHERE id = ${id}`)[0]!;
const ledger = () => adminSql<{ quantity_delta: string; reason: string; deployment_id: string; leg_id: string }[]>`SELECT quantity_delta, reason, deployment_id, leg_id FROM app.position_ledger_entries WHERE reason <> 'invest' OR leg_id IN (SELECT id FROM app.operation_legs WHERE recovery_of IS NOT NULL) ORDER BY created_at, id`;
const cash = () => adminSql<{ amount_micro: string; reason: string; leg_id: string }[]>`SELECT amount_micro, reason, leg_id FROM app.position_cash_entries ORDER BY created_at, id`;
const post = (h: Record<string, string>, path: string) => request(app).post(path).set(h).send({});

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

/** An IN_PROGRESS operation of `kind` with a settled network fee and one asset leg that is PENDING_CHAIN with a finalized source; `legSpec` shapes the asset leg. */
async function arrange(kind: Kind = "invest", leg: "buy" | "sell" = "buy") {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets: [SOL, TKN] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  const tkn = basket.deployments[1];
  const positionId = kind === "invest" || kind === "repair" ? null : await seedPosition(user.userId, basket, [{ deploymentId: tkn!.deploymentId, quantity: 1_000_000n }]);
  if (kind === "rebalance" && leg === "buy") await seedCash(user.userId, basket, positionId!, 100_000_000n);
  const repairPosition = kind === "repair" ? await seedPosition(user.userId, basket, [{ deploymentId: tkn!.deploymentId, quantity: 1_000n }]) : null;
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, position_id, deployment_id, repair_shares, kind, status, amount_usdc, sell_percent, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
    VALUES (gen_random_uuid(), ${user.userId}, ${kind === "repair" ? null : basket.basketId}, ${positionId}, ${kind === "repair" ? tkn!.deploymentId : null}, ${repairPosition ? adminSql.json({ [repairPosition]: "1000" }) : null},
      ${kind}, 'IN_PROGRESS', ${kind === "invest" ? 1000000000 : null}, ${kind === "sell_to_usdc" ? 100 : null}, 100, 182400, ${basket.versionId}, 'key-12345678', now() + interval '30 minutes') RETURNING id`;
  await adminSql`
    INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in, status)
    VALUES (gen_random_uuid(), ${op!.id}, 1, 'network_fee', 'solana', 'solana', 70000, 'SETTLED')`;
  const sell = leg === "sell";
  const [asset] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, from_deployment_id, to_chain, to_deployment_id, amount_in, provider, status, source_tx, submitted_at)
    VALUES (gen_random_uuid(), ${op!.id}, 2, 'cross_chain', ${sell ? "base" : "solana"}, ${sell ? tkn!.deploymentId : null}, ${sell ? "solana" : "base"}, ${sell ? null : tkn!.deploymentId},
      ${sell ? "400000" : "100000000"}, 'lifi', 'PENDING_CHAIN', ${sell ? "0xsrc" : "sig-bridge"}, now()) RETURNING id`;
  if (sell) fakes.evm.receipts.set("0xsrc", { success: true, blockNumber: 100n, head: 1000n, logs: [] });
  else chain.solanaFinality.set("sig-bridge", "finalized");
  return { chain, basket, user, opId: op!.id, assetId: asset!.id, tkn: tkn!, positionId, repairPosition, sell };
}

/** LI.FI says DONE / PARTIAL with `token` delivered in `dest`; the chain shows `onChain` of it received by the user (null = a transfer to somebody else only). */
function partial(a: Awaited<ReturnType<typeof arrange>>, onChain: bigint | null, over: { providerAmount?: string } = {}) {
  const sourceTx = a.sell ? "0xsrc" : "sig-bridge";
  if (a.sell) {
    a.chain.solanaFinality.set("sol-dest", "finalized");
    if (onChain !== null) a.chain.solanaReceived.set(`sol-dest:${a.user.solanaAddress}`, onChain);
    else a.chain.solanaReceived.set(`sol-dest:${a.user.solanaAddress}`, 0n);
    a.chain.lifiStatus.set(sourceTx, { state: "UNKNOWN", reason: "partial", substatus: "PARTIAL", receiving: { txHash: "sol-dest", token: { address: WRAPPED, decimals: 6, symbol: "WTK" } }, ...over } as never);
    return;
  }
  const to = onChain === null ? "0x" + "33".repeat(20) : a.user.evmAddress;
  fakes.evm.receipts.set("0xdest", { success: true, blockNumber: 100n, head: 1000n, logs: [{ address: DELIVERED, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(to)], data: "0x" + (onChain ?? 777n).toString(16) }] });
  a.chain.lifiStatus.set(sourceTx, { state: "UNKNOWN", reason: "partial", substatus: "PARTIAL", receiving: { txHash: "0xdest", token: { address: DELIVERED, decimals: 6, symbol: "USDC" } }, ...over } as never);
}

/** The recovery leg is signed and sent (a submitted source), the chain shows it final, and `received` of the target arrived. */
async function settleRecovery(a: Awaited<ReturnType<typeof arrange>>, recoveryId: string, received: bigint) {
  if (a.sell) {
    a.chain.solanaFinality.set("sig-recovery", "finalized");
    a.chain.solanaReceived.set(`sig-recovery:${a.user.solanaAddress}`, received);
  } else {
    fakes.evm.receipts.set("0xrecovery", { success: true, blockNumber: 200n, head: 1000n, logs: [{ address: a.tkn.address!, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(a.user.evmAddress)], data: "0x" + received.toString(16) }] });
  }
  await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = ${a.sell ? "sig-recovery" : "0xrecovery"}, submitted_at = now() WHERE id = ${recoveryId}`;
  await trackLeg(recoveryId);
}

describe("recovery after a failed destination swap", () => {
  it("PARTIAL with chain evidence: the leg fails DESTINATION_SWAP_FAILED, a recovery swap is appended from the evidenced amount (299, not the provider's 300), the operation stays open", async () => {
    const a = await arrange();
    partial(a, 299_000_000n, { providerAmount: "300000000" });
    await trackLeg(a.assetId);
    const [, original, recovery] = await legs(a.opId);
    expect(original).toMatchObject({ status: "FAILED", failure_reason: "DESTINATION_SWAP_FAILED", provider_substatus: "PARTIAL", recovery_token: { chain: "base", address: DELIVERED, decimals: 6, symbol: "USDC", amount: "299000000" } });
    expect(recovery).toMatchObject({
      sequence: 3, kind: "swap", status: "PLANNED", from_chain: "base", to_chain: "base", to_deployment_id: a.tkn.deploymentId, amount_in: "299000000", gas_payer: "platform_gas_drop", recovery_of: original!.id, min_out: "296010000",
      route_summary: { fromToken: DELIVERED, symbol: "USDC", decimals: 6 },
    });
    expect(recovery!.expected_tx).toMatchObject({ gasReserved: false, gasDropNative: "10000" });
    expect((await opRow(a.opId)).status).toBe("IN_PROGRESS");
    expect(await ledger()).toHaveLength(0);
  });

  it("no readable evidence (nothing arrived for the user), or no estimate: the leg stays UNKNOWN and nothing is appended", async () => {
    const a = await arrange();
    partial(a, null);
    await trackLeg(a.assetId);
    expect((await legs(a.opId)).map((l) => l.status)).toEqual(["SETTLED", "UNKNOWN"]);
    partial(a, 299_000_000n);
    vi.mocked(lifi.estimate).mockRejectedValueOnce(new Error("provider down"));
    await trackLeg(a.assetId, 1);
    expect((await legs(a.opId)).map((l) => l.status)).toEqual(["SETTLED", "UNKNOWN"]);
    await trackLeg(a.assetId, 1); // the hourly recheck finds the evidence and the estimate: now it recovers
    expect((await legs(a.opId)).map((l) => l.status)).toEqual(["SETTLED", "FAILED", "PLANNED"]);
  });

  it("re-running the tracker, even concurrently, creates one recovery leg and no duplicate ledger or cash rows", async () => {
    const a = await arrange("rebalance");
    partial(a, 299_000_000n);
    const results = await Promise.allSettled([trackLeg(a.assetId), trackLeg(a.assetId)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    await trackLeg(a.assetId);
    await trackLeg(a.assetId, 1);
    expect((await legs(a.opId)).map((l) => l.status)).toEqual(["SETTLED", "FAILED", "PLANNED"]);
    expect((await cash()).filter((c) => c.reason === "rebalance_buy")).toHaveLength(1);
    expect(await ledger()).toHaveLength(0);
  });

  it("invest: the recovery is quoted with a gas top-up within the caps, signed and settled: ledger invest from what it received, operation COMPLETED", async () => {
    const a = await arrange();
    partial(a, 299_000_000n);
    await trackLeg(a.assetId);
    const recovery = (await legs(a.opId))[2]!;
    fakes.evm.balances.clear();

    const first = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/quote`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ transaction: null, gasDrop: { status: "pending", txHash: "0xdrop1" } });
    expect(fakes.evm.sentNative).toEqual([{ chain: "base", to: a.user.evmAddress, value: 10_000n }]);
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'base'`).toEqual([{ amount_native: "10000" }]);
    fakes.evm.receipts.set("0xdrop1", { success: true, blockNumber: 1n, head: 100n, logs: [] });
    const second = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/quote`);
    expect(second.body).toMatchObject({ gasDrop: { status: "confirmed" }, transaction: { kind: "evm", to: EVM_TX.to }, approval: null });
    // the quote swaps the delivered token (from the route summary, not a registry deployment) for the original target
    const call = vi.mocked(lifi.quote).mock.calls.at(-1)![0];
    expect(call).toMatchObject({ fromChain: "base", fromToken: DELIVERED, toChain: "base", toToken: a.tkn.address, fromAmount: 299_000_000n });
    expect(call.deny).toBeDefined();

    fakes.evm.transactions.set("0xrecovery", { from: a.user.evmAddress, ...EVM_TX });
    const sent = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/submit`).send({ txHash: "0xrecovery" });
    expect(sent.status).toBe(200);
    await settleRecovery(a, recovery.id, 290_000_000n);
    const after = await legs(a.opId);
    expect(after[2]).toMatchObject({ status: "SETTLED", amount_received: "290000000" });
    expect(await adminSql`SELECT quantity_delta, reason, deployment_id, leg_id FROM app.position_ledger_entries`).toEqual([{ quantity_delta: "290000000", reason: "invest", deployment_id: a.tkn.deploymentId, leg_id: recovery.id }]);
    expect((await opRow(a.opId)).status).toBe("COMPLETED");
  });

  it("a recovery that would exceed today's gas cap is refused with 409 GAS_BUDGET_EXHAUSTED and sends nothing", async () => {
    const a = await arrange();
    partial(a, 299_000_000n);
    await trackLeg(a.assetId);
    const recovery = (await legs(a.opId))[2]!;
    fakes.evm.balances.clear();
    await adminSql`INSERT INTO app.sponsor_usage (user_id, chain, day, amount_native) VALUES (${a.user.userId}, 'base', (now() at time zone 'utc')::date, 2000000000000000)`;
    const res = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/quote`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GAS_BUDGET_EXHAUSTED");
    expect(fakes.evm.sentNative).toHaveLength(0);
  });

  it("rebalance buy: cash is debited by the original amountIn when the leg fails, the ledger is credited when the recovery settles", async () => {
    const a = await arrange("rebalance");
    partial(a, 299_000_000n);
    await trackLeg(a.assetId);
    expect(await cash()).toEqual(expect.arrayContaining([{ amount_micro: "-100000000", reason: "rebalance_buy", leg_id: a.assetId }]));
    expect(await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'rebalance'`).toHaveLength(0);
    const recovery = (await legs(a.opId))[2]!;
    await settleRecovery(a, recovery.id, 290_000_000n);
    expect(await adminSql`SELECT quantity_delta, leg_id FROM app.position_ledger_entries WHERE reason = 'rebalance'`).toEqual([{ quantity_delta: "290000000", leg_id: recovery.id }]);
    expect((await cash()).filter((c) => c.reason === "rebalance_buy")).toHaveLength(1);
    expect((await opRow(a.opId)).status).toBe("COMPLETED");
  });

  it("rebalance sell: the sold asset is debited when the leg fails, the proceeds credit basket cash when the recovery settles (never twice)", async () => {
    const a = await arrange("rebalance", "sell");
    partial(a, 5_000_000n);
    await trackLeg(a.assetId);
    await trackLeg(a.assetId, 1);
    expect(await adminSql`SELECT quantity_delta, reason, leg_id FROM app.position_ledger_entries WHERE reason = 'rebalance'`).toEqual([{ quantity_delta: "-400000", reason: "rebalance", leg_id: a.assetId }]);
    expect((await cash()).filter((c) => c.reason === "rebalance_sell")).toHaveLength(0);
    const recovery = (await legs(a.opId))[2]!;
    expect(recovery).toMatchObject({ from_chain: "solana", to_chain: "solana", to_deployment_id: null, amount_in: "5000000", gas_payer: "platform_fee_payer", route_summary: { fromToken: WRAPPED } });
    await settleRecovery(a, recovery.id, 4_900_000n);
    expect((await cash()).filter((c) => c.reason === "rebalance_sell")).toEqual([{ amount_micro: "4900000", reason: "rebalance_sell", leg_id: recovery.id }]);
    expect((await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'rebalance'`)).toHaveLength(1);
    expect((await opRow(a.opId)).status).toBe("COMPLETED");
  });

  it("plain sell: the debit is written at failure; the recovery's proceeds are wallet USDC (no further entry) and the operation completes", async () => {
    const a = await arrange("sell_to_usdc", "sell");
    partial(a, 5_000_000n);
    await trackLeg(a.assetId);
    expect(await adminSql`SELECT quantity_delta, reason FROM app.position_ledger_entries WHERE reason = 'sell'`).toEqual([{ quantity_delta: "-400000", reason: "sell" }]);
    await settleRecovery(a, (await legs(a.opId))[2]!.id, 4_900_000n);
    expect(await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'sell'`).toHaveLength(1);
    expect(await cash()).toHaveLength(0);
    expect((await opRow(a.opId)).status).toBe("COMPLETED");
  });

  it("repair: the recovery's received amount is split by shortfall (D-080) when it settles", async () => {
    const a = await arrange("repair");
    partial(a, 299_000_000n);
    await trackLeg(a.assetId);
    expect(await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'repair'`).toHaveLength(0);
    await settleRecovery(a, (await legs(a.opId))[2]!.id, 800n);
    expect(await adminSql`SELECT position_id, quantity_delta FROM app.position_ledger_entries WHERE reason = 'repair'`).toEqual([{ position_id: a.repairPosition, quantity_delta: "800" }]);
    expect((await opRow(a.opId)).status).toBe("COMPLETED");
  });

  it("stop during recovery: the operation is PARTIAL, the recovery leg is never sent, and the gas reserved for it (Solana, at quote time) is given back", async () => {
    const a = await arrange("rebalance", "sell");
    partial(a, 5_000_000n);
    await trackLeg(a.assetId);
    const recovery = (await legs(a.opId))[2]!;
    const quoted = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/quote`);
    expect(quoted.status).toBe(200);
    expect(quoted.body.transaction.kind).toBe("solana");
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'solana'`).toEqual([{ amount_native: "10000" }]);
    expect((await opRow(a.opId)).gas_reserved).toEqual({ solana: "10000" });
    const requote = await post(a.user.h, `/v1/operations/${a.opId}/legs/${recovery.id}/quote`); // a second quote reserves nothing more
    expect(requote.status).toBe(200);
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'solana'`).toEqual([{ amount_native: "10000" }]);

    const stopped = await post(a.user.h, `/v1/operations/${a.opId}/cancel`);
    expect(stopped.status).toBe(200);
    expect((await opRow(a.opId)).status).toBe("PARTIAL");
    expect((await legs(a.opId))[2]!.status).toBe("PLANNED");
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'solana'`).toEqual([{ amount_native: "0" }]);
    expect(await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'rebalance'`).toHaveLength(1); // the debit stays: the funds left
  });

  it("a recovery leg whose own transfer ends PARTIAL is UNKNOWN for ops and is not recovered again", async () => {
    const a = await arrange();
    partial(a, 299_000_000n);
    await trackLeg(a.assetId);
    const recovery = (await legs(a.opId))[2]!;
    // A same-chain swap has no provider status; make this one cross-chain to exercise the guard.
    await adminSql`UPDATE app.operation_legs SET status = 'PENDING_CHAIN', from_chain = 'solana', source_tx = 'sig-rec2', submitted_at = now() WHERE id = ${recovery.id}`;
    a.chain.solanaFinality.set("sig-rec2", "finalized");
    a.chain.lifiStatus.set("sig-rec2", { state: "UNKNOWN", reason: "partial", substatus: "PARTIAL", receiving: { txHash: "0xdest", token: { address: DELIVERED, decimals: 6, symbol: "USDC" } } });
    await trackLeg(recovery.id);
    expect((await legs(a.opId)).map((l) => l.status)).toEqual(["SETTLED", "FAILED", "UNKNOWN"]);
  });

  it("NOT_PROCESSABLE_REFUND_NEEDED keeps the leg PENDING_CHAIN and shows LI.FI's substatus", async () => {
    const a = await arrange();
    a.chain.lifiStatus.set("sig-bridge", { state: "PENDING", substatus: "NOT_PROCESSABLE_REFUND_NEEDED" });
    await expect(trackLeg(a.assetId)).rejects.toThrow("not final");
    expect((await legs(a.opId))[1]).toMatchObject({ status: "PENDING_CHAIN", provider_substatus: "NOT_PROCESSABLE_REFUND_NEEDED" });
  });
});
