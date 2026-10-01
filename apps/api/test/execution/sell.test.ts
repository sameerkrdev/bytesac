import { Transaction } from "@scure/btc-signer";
import createHttpError from "http-errors";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { seedPlatformWallets } from "../../src/services/gas";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, btcInputKey, btcPsbt, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 3000 };
const BTC: SeedAsset = { symbol: "BTC", chain: "bitcoin", bps: 2000 };
type H = Record<string, string>;

const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const sell = (h: H, positionId: string, over: object = {}) => post(h, "/v1/operations/sell", { positionId, percent: 50, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa", ...over });
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const submit = (h: H, opId: string, legId: string, body: object) => post(h, `/v1/operations/${opId}/legs/${legId}/submit`, body);
const setLeg = (id: string, status: string) => adminSql`UPDATE app.operation_legs SET status = ${status} WHERE id = ${id}`;

async function arrange(over: { usdc?: bigint } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const wallet = solanaTestWallet();
  const basket = await seedBasket({ assets: [SOL, ETH, BTC] });
  const user = await seedUser({ wallet, bitcoin: true });
  const [sol, eth, btc] = basket.deployments;
  const positionId = await seedPosition(user.userId, basket, [{ deploymentId: sol!.deploymentId, quantity: 4_000_000_000n }, { deploymentId: eth!.deploymentId, quantity: 2n * 10n ** 18n }, { deploymentId: btc!.deploymentId, quantity: 100_000_000n }]);
  chain.balances.set(balanceKey(user.solanaAddress, null), 4_000_000_000n);
  chain.balances.set(balanceKey(user.btcAddress, null), 100_000_000n);
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 0n); // no USDC to prepay the fee unless a test says so
  // The user moved some ETH elsewhere: the wallet holds 0.5 ETH although the ledger says 2.
  fakes.evm.balances.set(`ethereum:${user.evmAddress}`, 5n * 10n ** 17n);
  return { chain, wallet, basket, user, positionId, deployments: { sol: sol!, eth: eth!, btc: btc! } };
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("sell plan", () => {
  it("sells min(ledger x percent, wallet balance) per deployment and puts the network fee last (Review Focus 4)", async () => {
    const { user, positionId } = await arrange();
    const res = await sell(user.h, positionId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "sell_to_usdc", status: "PLANNED", sellPercent: 50, amountUsdc: null });
    expect(res.body.legs.map((l: { kind: string; fromChain: string; amountIn: string; gasPayer: string }) => [l.kind, l.fromChain, l.amountIn, l.gasPayer])).toEqual([
      ["swap", "solana", "2000000000", "platform_fee_payer"],
      ["cross_chain", "ethereum", "500000000000000000", "platform_gas_drop"], // wallet (0.5) < ledger x 50% (1.0)
      ["cross_chain", "bitcoin", "50000000", "user_btc_inputs"],
      ["network_fee", "solana", "182400", "platform_fee_payer"],
    ]);
    expect(res.body.legs[1].routeSummary).toMatchObject({ symbol: expect.any(String), decimals: 18 }); // the client formats raw amounts with these
    expect(res.body.legs.at(-1).sequence).toBe(4);
    expect(res.body.legs.every((l: { toChain: string }) => l.toChain === "solana")).toBe(true);
    const usage = await adminSql<{ chain: string; amount_native: string }[]>`SELECT chain, amount_native FROM app.sponsor_usage WHERE user_id = ${user.userId} ORDER BY chain`;
    expect(Object.fromEntries(usage.map((u) => [u.chain, u.amount_native]))).toEqual({ solana: String(10_000 + 10_000), ethereum: "150000000000000" });
  });

  it("skips deployments the wallet no longer holds and refuses when nothing is left", async () => {
    const { user, positionId, chain } = await arrange();
    chain.balances.set(balanceKey(user.btcAddress, null), 0n);
    fakes.evm.balances.clear();
    const res = await sell(user.h, positionId);
    expect(res.body.legs.map((l: { fromChain: string }) => l.fromChain)).toEqual(["solana", "solana"]);
    await post(user.h, `/v1/operations/${res.body.id}/cancel`);
    chain.balances.set(balanceKey(user.solanaAddress, null), 0n);
    const none = await sell(user.h, positionId, { idempotencyKey: "sell-bbbbbbbb" });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("an EVM sell leg waits for the gas drop, then quotes, and the hash is verified against the quote", async () => {
    const { user, positionId, chain } = await arrange();
    const op = (await sell(user.h, positionId)).body;
    const [solLeg, ethLeg] = op.legs;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await setLeg(solLeg.id, "SETTLED");
    const quotesBefore = chain.quotes.length;
    fakes.evm.balances.clear(); // the wallet holds no native gas for the EVM leg

    const first = await quote(user.h, op.id, ethLeg.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ transaction: null, quoteExpiresAt: null, gasDrop: { status: "pending", txHash: "0xdrop1" } });
    expect(fakes.evm.sentNative).toEqual([{ chain: "ethereum", to: user.evmAddress, value: 150_000_000_000_000n }]);
    expect(chain.quotes).toHaveLength(quotesBefore); // no quote is fetched while the drop is unconfirmed
    // the drop was reserved with the plan: sending it did not use the budget a second time
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'ethereum'`).toEqual([{ amount_native: "150000000000000" }]);

    fakes.evm.receipts.set("0xdrop1", { success: true, blockNumber: 1n, head: 2n, logs: [] });
    const second = await quote(user.h, op.id, ethLeg.id);
    expect(second.body.gasDrop).toEqual({ status: "confirmed", txHash: "0xdrop1" });
    expect(second.body.transaction).toEqual({ kind: "evm", to: "0x" + "ab".repeat(20), data: "0x1234", value: "0", chainId: 1 });
    expect(fakes.evm.sentNative).toHaveLength(1);

    const tx = { from: user.evmAddress, to: "0x" + "ab".repeat(20), input: "0x1234", value: 0n, blockNumber: null };
    fakes.evm.transactions.set("0xbad", { ...tx, input: "0xdead" });
    const mismatch = await submit(user.h, op.id, ethLeg.id, { txHash: "0xbad" });
    expect(mismatch.body.error.code).toBe("TX_MISMATCH");
    fakes.evm.transactions.set("0xbadfrom", { ...tx, from: "0x" + "11".repeat(20) });
    expect((await submit(user.h, op.id, ethLeg.id, { txHash: "0xbadfrom" })).body.error.code).toBe("TX_MISMATCH");
    expect((await submit(user.h, op.id, ethLeg.id, { txHash: "0xmissing" })).status).toBe(400);
    fakes.evm.transactions.set("0xgood", tx);
    const ok = await submit(user.h, op.id, ethLeg.id, { txHash: "0xgood" });
    expect(ok.status).toBe(200);
    expect(ok.body.legs[1]).toMatchObject({ status: "SUBMITTED", sourceTx: "0xgood" });
  });

  it("a Bitcoin leg: a changed PSBT is PSBT_MISMATCH and nothing is broadcast; the signed quoted PSBT is finalized and broadcast once", async () => {
    const { user, positionId, chain } = await arrange();
    const op = (await sell(user.h, positionId)).body;
    const btcLeg = op.legs[2];
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    for (const l of op.legs.slice(0, 2)) await setLeg(l.id, "SETTLED");
    const q = await quote(user.h, op.id, btcLeg.id);
    expect(q.body.transaction.kind).toBe("bitcoin");
    expect(q.body.transaction.inputCount).toBeGreaterThanOrEqual(1); // the wallet signs every input

    const sign = (psbt: string, mutate?: (tx: Transaction) => void) => {
      const tx = Transaction.fromPSBT(Buffer.from(psbt, "base64"), { allowUnknownOutputs: true });
      mutate?.(tx);
      tx.sign(btcInputKey.priv);
      return Buffer.from(tx.toPSBT()).toString("base64");
    };
    const tampered = sign(q.body.transaction.psbtBase64, (tx) => tx.updateOutput(0, { amount: 1n }));
    const bad = await submit(user.h, op.id, btcLeg.id, { signedPsbt: tampered });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("PSBT_MISMATCH");
    expect(chain.broadcasts).toHaveLength(0);
    expect((await adminSql<{ status: string }[]>`SELECT status FROM app.operation_legs WHERE id = ${btcLeg.id}`)[0]!.status).toBe("PLANNED");

    const ok = await submit(user.h, op.id, btcLeg.id, { signedPsbt: sign(q.body.transaction.psbtBase64) });
    expect(ok.status).toBe(200);
    expect(chain.broadcasts).toHaveLength(1);
    expect(ok.body.legs[2]).toMatchObject({ status: "SUBMITTED" });
    expect(ok.body.legs[2].sourceTx).toMatch(/^[0-9a-f]{64}$/);
  });

  it("quotes the network fee leg last, once everything settled and the fee is covered", async () => {
    const { user, positionId, chain, wallet } = await arrange();
    const op = (await sell(user.h, positionId)).body;
    const fee = op.legs[3];
    expect((await quote(user.h, op.id, fee.id)).body.error.code).toBe("INVALID_TRANSITION");
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    for (const l of op.legs.slice(0, 3)) await setLeg(l.id, "SETTLED");
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 100_000n);
    expect((await quote(user.h, op.id, fee.id)).body.error.code).toBe("INSUFFICIENT_BALANCE");
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 5_000_000n);
    const q = await quote(user.h, op.id, fee.id);
    expect(q.status).toBe(200);
    expect(q.body.transaction.kind).toBe("solana");
    void wallet;
  });
});

describe("leave and sell former assets", () => {
  it("leaving closes the position without any transaction; selling the former assets then works", async () => {
    const { user, positionId, chain } = await arrange();
    const res = await post(user.h, `/v1/positions/${positionId}/leave`);
    expect(res.status).toBe(204);
    const [p] = await adminSql<{ status: string; closed_at: Date | null }[]>`SELECT status, closed_at FROM app.basket_positions WHERE id = ${positionId}`;
    expect(p!.status).toBe("CLOSED");
    expect(p!.closed_at).toBeTruthy();
    expect(await adminSql`SELECT 1 FROM app.operation_legs WHERE status <> 'SETTLED' AND from_chain IS NOT NULL AND source_tx IS NOT NULL`).toHaveLength(0);
    expect(chain.quotes).toHaveLength(0);
    expect(vi.mocked((await import("../../src/providers/solana-tx")).connection.sendRawTransaction)).not.toHaveBeenCalled();
    expect((await post(user.h, `/v1/positions/${positionId}/leave`)).status).toBe(409);
    const former = await sell(user.h, positionId, { percent: 100 });
    expect(former.status).toBe(201);
    expect(former.body.kind).toBe("sell_former");
    expect(former.body.legs[0].amountIn).toBe("4000000000");
  });

  it("only the owner can leave or sell a position", async () => {
    const { positionId } = await arrange();
    const stranger = await seedUser();
    expect((await post(stranger.h, `/v1/positions/${positionId}/leave`)).status).toBe(404);
    expect((await sell(stranger.h, positionId)).status).toBe(404);
  });
});

describe("review fixes", () => {
  const nativeEthBalance = (user: { evmAddress: string }, wei: bigint) => fakes.evm.balances.set(`ethereum:${user.evmAddress}`, wei);

  it("D1: with enough USDC on Solana the network fee is the FIRST leg; the EVM gas drop waits until it has settled", async () => {
    const { user, positionId, chain } = await arrange({ usdc: 50_000_000n });
    const op = (await sell(user.h, positionId)).body;
    expect(op.legs.map((l: { kind: string; sequence: number }) => [l.sequence, l.kind])).toEqual([[1, "network_fee"], [2, "swap"], [3, "cross_chain"], [4, "cross_chain"]]);
    const ethLeg = op.legs[2];
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await setLeg(op.legs[0].id, "PENDING_CHAIN");
    await setLeg(op.legs[1].id, "SETTLED");
    fakes.evm.balances.delete(`ethereum:${user.evmAddress}`);
    const waiting = await quote(user.h, op.id, ethLeg.id);
    expect(waiting.body).toMatchObject({ transaction: null, gasDrop: { status: "pending", txHash: null } });
    expect(fakes.evm.sentNative).toHaveLength(0); // fee not settled: no platform gas yet
    await setLeg(op.legs[0].id, "SETTLED");
    const sent = await quote(user.h, op.id, ethLeg.id);
    expect(sent.body.gasDrop).toMatchObject({ status: "pending", txHash: "0xdrop1" });
    void chain;
  });

  it("D1: without USDC the fee stays last and EVM gas is dropped anyway (an accepted loss within the caps)", async () => {
    const { user, positionId } = await arrange();
    const op = (await sell(user.h, positionId)).body;
    expect(op.legs.at(-1).kind).toBe("network_fee");
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await setLeg(op.legs[0].id, "SETTLED");
    fakes.evm.balances.delete(`ethereum:${user.evmAddress}`);
    expect((await quote(user.h, op.id, op.legs[1].id)).body.gasDrop).toMatchObject({ status: "pending", txHash: "0xdrop1" });
  });

  it("I8: selling ALL of a native EVM asset still gets a gas drop (the wallet needs the amount plus gas)", async () => {
    const { user, positionId } = await arrange();
    nativeEthBalance(user, 2n * 10n ** 18n); // the whole ledger holding
    const op = (await sell(user.h, positionId, { percent: 100 })).body;
    const ethLeg = op.legs.find((l: { fromChain: string }) => l.fromChain === "ethereum");
    expect(ethLeg.amountIn).toBe((2n * 10n ** 18n).toString());
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    for (const l of op.legs.filter((x: { sequence: number }) => x.sequence < ethLeg.sequence)) await setLeg(l.id, "SETTLED");
    const q = await quote(user.h, op.id, ethLeg.id);
    expect(q.body.gasDrop.status).toBe("pending");
    expect(fakes.evm.sentNative).toHaveLength(1); // balance (2 ETH) covers the gas alone but not value + gas
  });

  it("I8: selling all Bitcoin keeps the miner-fee ceiling back so the PSBT can be built", async () => {
    const { user, positionId } = await arrange();
    const op = (await sell(user.h, positionId, { percent: 100 })).body;
    expect(op.legs.find((l: { fromChain: string }) => l.fromChain === "bitcoin").amountIn).toBe("99900000"); // 1 BTC - 100,000 sats
  });

  it("I8: an ERC-20 sell's gas drop covers the approval transaction too (2x the estimate instead of 1.5x)", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    const wallet = solanaTestWallet();
    const basket = await seedBasket({ assets: [{ symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", bps: 10_000 }] });
    const user = await seedUser({ wallet });
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 1000n }]);
    fakes.evm.balances.set(`ethereum:${user.evmAddress}:${basket.deployments[0]!.address}`, 1000n);
    const op = (await sell(user.h, positionId)).body;
    expect((await adminSql`SELECT expected_tx FROM app.operation_legs WHERE id = ${op.legs[0].id}`)[0]!.expected_tx).toMatchObject({ gasDropNative: "200000000000000" }); // 100,000 gwei x 2
    void chain;
  });

  it("spec 7: a sell is refused while the EVM gas wallet cannot fund the planned drop", async () => {
    const { user, positionId } = await arrange();
    fakes.evm.balances.delete(`ethereum:${fakes.evm.gasWalletAddress()}`);
    const res = await sell(user.h, positionId);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect(await adminSql`SELECT 1 FROM app.operations WHERE status = 'PLANNED'`).toHaveLength(0);
  });

  describe("Bitcoin PSBT checks (I5)", () => {
    async function btcLegWith(psbt: (refund: string, sats: bigint) => string) {
      const ctx = await arrange();
      const { lifi } = await import("../../src/providers/routes/lifi");
      const original = vi.mocked(lifi.quote).getMockImplementation()!;
      vi.mocked(lifi.quote).mockImplementation(async (i) => {
        const q = await original(i);
        return i.fromChain === "bitcoin" ? { ...q, transaction: { kind: "bitcoin" as const, psbtBase64: psbt(i.fromAddress, i.fromAmount) } } : q;
      });
      const op = (await sell(ctx.user.h, ctx.positionId)).body;
      await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
      for (const l of op.legs.slice(0, 2)) await setLeg(l.id, "SETTLED");
      return { ...ctx, op, btcLeg: op.legs[2] };
    }
    const refused = async (psbt: (refund: string, sats: bigint) => string) => {
      const { user, op, btcLeg } = await btcLegWith(psbt);
      const res = await quote(user.h, op.id, btcLeg.id);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
    };
    it("refuses a deposit that is not the leg's amount", () => refused((r, s) => btcPsbt(r, s, { depositSats: s - 1n })));
    it("refuses a PSBT with no refund output to the user", () => refused((r, s) => btcPsbt(r, s, { changeSats: null })));
    it("refuses a miner fee above min(2% of the sale, 100,000 sats)", () => refused((r, s) => btcPsbt(r, s, { inputSats: s + 340_000n })));
    it("refuses a user-signed PSBT that spends different inputs than the quote", async () => {
      const { user, op, btcLeg, chain } = await btcLegWith((r, s) => btcPsbt(r, s));
      const q = await quote(user.h, op.id, btcLeg.id);
      const other = btcPsbt(user.btcAddress, 50_000_000n); // same outputs shape, a different (random) input
      const tx = Transaction.fromPSBT(Buffer.from(q.body.transaction.psbtBase64, "base64"), { allowUnknownOutputs: true });
      const swapped = Transaction.fromPSBT(Buffer.from(other, "base64"), { allowUnknownOutputs: true });
      for (let n = 0; n < tx.outputsLength; n++) swapped.updateOutput(n, { amount: tx.getOutput(n).amount });
      swapped.sign(btcInputKey.priv);
      const res = await submit(user.h, op.id, btcLeg.id, { signedPsbt: Buffer.from(swapped.toPSBT()).toString("base64") });
      expect(res.body.error.code).toBe("PSBT_MISMATCH");
      expect(chain.broadcasts).toHaveLength(0);
    });
    it("an unsigned PSBT is a 409, and a node rejection is BROADCAST_REJECTED with the claim released", async () => {
      const { user, op, btcLeg, chain } = await btcLegWith((r, s) => btcPsbt(r, s));
      const q = await quote(user.h, op.id, btcLeg.id);
      expect((await submit(user.h, op.id, btcLeg.id, { signedPsbt: q.body.transaction.psbtBase64 })).body.error.code).toBe("PSBT_MISMATCH");
      const signed = (() => { const t = Transaction.fromPSBT(Buffer.from(q.body.transaction.psbtBase64, "base64"), { allowUnknownOutputs: true }); t.sign(btcInputKey.priv); return Buffer.from(t.toPSBT()).toString("base64"); })();
      const bitcoin = await import("../../src/providers/bitcoin");
      vi.mocked(bitcoin.broadcastBitcoin).mockRejectedValueOnce(createHttpError(409, "rejected", { code: "BROADCAST_REJECTED" }));
      expect((await submit(user.h, op.id, btcLeg.id, { signedPsbt: signed })).body.error.code).toBe("BROADCAST_REJECTED");
      expect((await adminSql<{ status: string; source_tx: string | null }[]>`SELECT status, source_tx FROM app.operation_legs WHERE id = ${btcLeg.id}`)[0]).toEqual({ status: "PLANNED", source_tx: null });
      expect((await submit(user.h, op.id, btcLeg.id, { signedPsbt: signed })).status).toBe(200);
      expect(chain.broadcasts).toHaveLength(1);
    });
  });
});
