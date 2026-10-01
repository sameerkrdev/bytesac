import { SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { connection } from "../../src/providers/solana-tx";
import { seedPlatformWallets } from "../../src/services/gas";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 3000 };
const BTC: SeedAsset = { symbol: "BTC", chain: "bitcoin", bps: 2000 };
type H = Record<string, string>;

const sends = () => vi.mocked(connection.sendRawTransaction).mock.calls.length;
const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const invest = (h: H, basketId: string, over: object = {}) => post(h, "/v1/operations/invest", { basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa", ...over });
const legs = (opId: string) => adminSql<{ id: string; sequence: number; kind: string; status: string; amount_in: string; to_chain: string; source_tx: string | null; built_message_hash: string | null; min_out: string | null }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;
const opRow = async (id: string) => (await adminSql<{ status: string }[]>`SELECT * FROM app.operations WHERE id = ${id}`)[0]!;

async function arrange(over: { assets?: SeedAsset[]; usdc?: bigint } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const wallet = solanaTestWallet();
  const basket = await seedBasket({ assets: over.assets ?? [SOL, ETH, BTC] });
  const user = await seedUser({ wallet, bitcoin: true });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 1_000_000_000n);
  return { chain, wallet, basket, user };
}

/** The wallet's step: signs a planner-built transaction and returns it with the fee-payer slot empty. */
const walletSign = (serializedBase64: string, wallet: ReturnType<typeof solanaTestWallet>) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64"));
  tx.sign([wallet.keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
};

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("invest plan", () => {
  it("builds the network fee leg first and splits the rest by weight; reserves the platform gas", async () => {
    const { basket, user, chain } = await arrange();
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    const op = res.body;
    expect(op).toMatchObject({ kind: "invest", status: "PLANNED", amountUsdc: "500000000", networkFeeUsdc: "182400", slippageBps: 100 });
    // fee = (0.002 + 3 x 0.05) USD x 1.2 = 0.1824 USDC; deployable 499.8176 USDC split 50/30/20
    expect(op.legs.map((l: { kind: string; toChain: string; amountIn: string }) => [l.kind, l.toChain, l.amountIn])).toEqual([
      ["network_fee", "solana", "182400"], ["swap", "solana", "249908800"], ["cross_chain", "ethereum", "149945280"], ["cross_chain", "bitcoin", "99963520"],
    ]);
    expect(op.legs.every((l: { status: string; gasPayer: string }) => l.status === "PLANNED" && l.gasPayer === "platform_fee_payer")).toBe(true);
    expect(BigInt(op.legs[1].minOut)).toBe((249_908_800n * 9900n) / 10_000n);
    expect(chain.quotes.every((q) => q.fromChain === "solana" && q.svmSponsor)).toBe(true);
    expect(chain.quotes.map((q) => q.toAddress)).toContain(user.btcAddress);
    const [usage] = await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${user.userId} AND chain = 'solana'`;
    // fee transfer 10,000 + 3 legs x (2 signatures x 5,000): the decoded fee-payer exposure, not LI.FI's smaller 5,000 figure
    expect(BigInt(usage!.amount_native)).toBe(10_000n + 3n * 10_000n);
    expect((await adminSql<{ gas_reserved: Record<string, string> }[]>`SELECT gas_reserved FROM app.operations`)[0]!.gas_reserved).toEqual({ solana: "40000" });
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'operation.planned'`).toHaveLength(1);
  });

  it("an idempotent repeat returns the same plan without a second operation", async () => {
    const { basket, user, chain } = await arrange();
    const first = await invest(user.h, basket.basketId);
    const calls = chain.quotes.length;
    const again = await invest(user.h, basket.basketId);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(chain.quotes).toHaveLength(calls);
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(1);
    const reused = await invest(user.h, basket.basketId, { amountUsdc: "600" });
    expect(reused.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("a second operation is refused while one is active, and a double click creates one (Review Focus 3)", async () => {
    const { basket, user } = await arrange();
    expect((await invest(user.h, basket.basketId)).status).toBe(201);
    const second = await invest(user.h, basket.basketId, { idempotencyKey: "key-bbbbbbbb" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("OPERATION_IN_PROGRESS");

    await resetDb();
    const fresh = await arrange();
    const race = await Promise.all([invest(fresh.user.h, fresh.basket.basketId, { idempotencyKey: "key-cccccccc" }), invest(fresh.user.h, fresh.basket.basketId, { idempotencyKey: "key-dddddddd" })]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(1);

    await resetDb();
    const same = await arrange();
    const twin = await Promise.all([invest(same.user.h, same.basket.basketId), invest(same.user.h, same.basket.basketId)]);
    expect(twin.map((r) => r.status)).toEqual([201, 201]);
    expect(twin[0]!.body.id).toBe(twin[1]!.body.id);
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(1);
  });

  it("refuses over the gas budget before any operation row exists (Review Focus 5)", async () => {
    const { basket, user } = await arrange();
    await adminSql`INSERT INTO app.sponsor_usage (user_id, chain, day, amount_native) VALUES (${user.userId}, 'solana', (now() at time zone 'utc')::date, 19990000)`;
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GAS_BUDGET_EXHAUSTED");
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(0);
    expect(await adminSql`SELECT 1 FROM app.operation_legs`).toHaveLength(0);
  });

  it("checks investability, eligibility, amount rules and the USDC balance", async () => {
    const a = await arrange();
    expect((await invest(a.user.h, a.basket.basketId, { amountUsdc: "99" })).body.error.code).toBe("VALIDATION_FAILED");
    expect((await invest(a.user.h, a.basket.basketId, { amountUsdc: "5000" })).body.error.code).toBe("INSUFFICIENT_BALANCE");
    await adminSql`UPDATE app.basket_versions SET minimum_increment_usdc = '50' WHERE id = ${a.basket.versionId}`;
    expect((await invest(a.user.h, a.basket.basketId, { amountUsdc: "125" })).body.error.code).toBe("VALIDATION_FAILED");
    expect((await invest(a.user.h, a.basket.basketId, { amountUsdc: "150" })).status).toBe(201);

    const paused = await seedBasket({ assets: [SOL], status: "PAUSED" });
    const other = await seedUser({ bitcoin: true });
    expect((await invest(other.h, paused.basketId)).body.error.code).toBe("NOT_INVESTABLE");
    const noPhone = await seedUser({ phone: false });
    const blocked = await invest(noPhone.h, a.basket.basketId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("NOT_ELIGIBLE");
    const noBtc = await seedUser();
    expect((await invest(noBtc.h, a.basket.basketId)).body.error.code).toBe("BTC_ADDRESS_REQUIRED");
  });

  it("needs a session", async () => {
    const { basket } = await arrange();
    expect((await post({ Origin: "http://localhost:3000", "X-Requested-With": "bytesac" }, "/v1/operations/invest", { basketId: basket.basketId, amountUsdc: "500", idempotencyKey: "key-aaaaaaaa" })).status).toBe(401);
  });
});

describe("quote and submit a Solana leg", () => {
  async function planned() {
    const ctx = await arrange();
    const op = (await invest(ctx.user.h, ctx.basket.basketId)).body;
    return { ...ctx, op, feeLeg: op.legs[0], solLeg: op.legs[1] };
  }
  const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
  const submit = (h: H, opId: string, legId: string, body: object) => post(h, `/v1/operations/${opId}/legs/${legId}/submit`, body);

  it("quotes the network fee transfer, then co-signs the user's signature and submits once", async () => {
    const { user, wallet, op, feeLeg, chain } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    expect(q.status).toBe(200);
    expect(q.body.transaction.kind).toBe("solana");
    expect((await legs(op.id))[0]!.built_message_hash).toMatch(/^[0-9a-f]{64}$/);
    const res = await submit(user.h, op.id, feeLeg.id, { signedTx: walletSign(q.body.transaction.serializedBase64, wallet) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.legs[0]).toMatchObject({ status: "SUBMITTED" });
    expect(res.body.legs[0].sourceTx).toBeTruthy();
    expect(sends()).toBe(1);
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: feeLeg.id } });
    expect(chain.broadcasts).toHaveLength(0);
    // every transition is audited
    expect((await adminSql`SELECT action FROM app.audit_events WHERE entity_id = ${feeLeg.id}`).map((r) => r.action)).toEqual(["leg.submitting", "leg.submitted"]);
  });

  it("refuses a swap leg until the fee leg is on-chain, then quotes it with the sponsor and the user's own addresses", async () => {
    const { user, wallet, op, feeLeg, solLeg, chain } = await planned();
    expect((await quote(user.h, op.id, solLeg.id)).body.error.code).toBe("INVALID_TRANSITION");
    const fee = await quote(user.h, op.id, feeLeg.id);
    await submit(user.h, op.id, feeLeg.id, { signedTx: walletSign(fee.body.transaction.serializedBase64, wallet) });
    expect((await quote(user.h, op.id, solLeg.id)).body.error.code).toBe("INVALID_TRANSITION"); // submitted is not yet confirmed
    await adminSql`UPDATE app.operation_legs SET status = 'PENDING_CHAIN' WHERE id = ${feeLeg.id}`;
    const q = await quote(user.h, op.id, solLeg.id);
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ estimatedOut: "249908800", minOut: "247409712", approval: null, gasDrop: null });
    expect(chain.quotes.at(-1)).toMatchObject({ fromChain: "solana", toChain: "solana", toAddress: user.solanaAddress });
    expect(chain.quotes.at(-1)!.svmSponsor).toBeTruthy();
  });

  it("rejects a transaction changed after it was prepared: TX_MISMATCH, nothing sent, the leg stays PLANNED (Review Focus 1)", async () => {
    const { user, wallet, op, feeLeg, solLeg } = await planned();
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${feeLeg.id}`;
    const q = await quote(user.h, op.id, solLeg.id);
    const tx = VersionedTransaction.deserialize(Buffer.from(q.body.transaction.serializedBase64, "base64"));
    tx.message.compiledInstructions[0]!.data[8] = 1; // the client edits the lamports in the instruction after the quote
    tx.sign([wallet.keypair]);
    const res = await submit(user.h, op.id, solLeg.id, { signedTx: Buffer.from(tx.serialize()).toString("base64") });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TX_MISMATCH");
    expect(sends()).toBe(0);
    expect((await legs(op.id))[1]!.status).toBe("PLANNED");
  });

  it("rejects an expired quote", async () => {
    const { user, wallet, op, feeLeg } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    await adminSql`UPDATE app.operation_legs SET quote_expires_at = now() - interval '1 second' WHERE id = ${feeLeg.id}`;
    const res = await submit(user.h, op.id, feeLeg.id, { signedTx: walletSign(q.body.transaction.serializedBase64, wallet) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("QUOTE_EXPIRED");
    expect(sends()).toBe(0);
    expect((await legs(op.id))[0]!.status).toBe("PLANNED");
  });

  it("records an unknown send outcome with its deterministic signature and a rejection as no submission", async () => {
    const { user, wallet, op, feeLeg } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    const signedTx = walletSign(q.body.transaction.serializedBase64, wallet);
    vi.mocked(connection.sendRawTransaction).mockRejectedValueOnce(new SendTransactionError({ action: "send", signature: "", transactionMessage: "preflight failed" }));
    const rejected = await submit(user.h, op.id, feeLeg.id, { signedTx });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect((await legs(op.id))[0]!.status).toBe("PLANNED");
    vi.mocked(connection.sendRawTransaction).mockRejectedValueOnce(new Error("timeout"));
    const unknown = await submit(user.h, op.id, feeLeg.id, { signedTx });
    expect(unknown.status).toBe(200);
    expect(unknown.body.legs[0].status).toBe("SUBMITTED");
    const expected = bs58.encode(VersionedTransaction.deserialize(Buffer.from(signedTx, "base64")).signatures[0]!);
    expect(unknown.body.legs[0].sourceTx).not.toBe(expected); // the co-signed signature is the fee payer's, not the unsigned slot
    expect(unknown.body.legs[0].sourceTx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
    expect(fakes.queue.jobs.filter((j) => j.name === "track-leg")).toHaveLength(1);
  });
});

describe("cancel and stop", () => {
  const cancel = (h: H, id: string) => post(h, `/v1/operations/${id}/cancel`);

  it("cancels a plan before anything is submitted and frees the slot", async () => {
    const { basket, user } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    const res = await cancel(user.h, op.id);
    expect(res.body.status).toBe("CANCELLED");
    expect((await request(app).get("/v1/portfolio").set(user.h)).body.history.map((o: { id: string }) => o.id)).toEqual([op.id]);
    expect((await invest(user.h, basket.basketId, { idempotencyKey: "key-eeeeeeee" })).status).toBe(201);
  });

  it("an expired plan stops taking quotes and no longer blocks a new one", async () => {
    const { basket, user } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 minute' WHERE id = ${op.id}`;
    const q = await post(user.h, `/v1/operations/${op.id}/legs/${op.legs[0].id}/quote`);
    expect(q.status).toBe(409);
    expect((await opRow(op.id)).status).toBe("CANCELLED");
    expect((await invest(user.h, basket.basketId, { idempotencyKey: "key-ffffffff" })).status).toBe(201);
  });

  it("stopping between legs is PARTIAL once an asset leg settled; a pending leg blocks it", async () => {
    const { basket, user } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${op.legs[0].id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'PENDING_CHAIN' WHERE id = ${op.legs[1].id}`;
    expect((await cancel(user.h, op.id)).status).toBe(409);
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${op.legs[1].id}`;
    expect((await cancel(user.h, op.id)).body.status).toBe("PARTIAL");
    expect((await cancel(user.h, op.id)).status).toBe(409);
  });

  it("another user cannot read, quote or cancel the operation", async () => {
    const { basket, user } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    const stranger = await seedUser();
    expect((await request(app).get(`/v1/operations/${op.id}`).set(stranger.h)).status).toBe(404);
    expect((await cancel(stranger.h, op.id)).status).toBe(404);
    expect((await post(stranger.h, `/v1/operations/${op.id}/legs/${op.legs[0].id}/quote`)).status).toBe(404);
  });
});


describe("review fixes", () => {
  async function ready() {
    const ctx = await arrange();
    const op = (await invest(ctx.user.h, ctx.basket.basketId)).body;
    return { ...ctx, op, feeLeg: op.legs[0], solLeg: op.legs[1] };
  }
  const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
  const submit = (h: H, opId: string, legId: string, body: object) => post(h, `/v1/operations/${opId}/legs/${legId}/submit`, body);
  const cancel = (h: H, id: string) => post(h, `/v1/operations/${id}/cancel`);
  const usage = async () => BigInt((await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE chain = 'solana'`)[0]?.amount_native ?? "0");

  it("I2: the leg is claimed before anything is sent, so a quote or cancel during the send is refused and the tx is sent once", async () => {
    const { user, wallet, op, feeLeg } = await ready();
    const q = await quote(user.h, op.id, feeLeg.id);
    const signedTx = walletSign(q.body.transaction.serializedBase64, wallet);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async (raw) => { await gate; return bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!); });
    const first = Promise.resolve(submit(user.h, op.id, feeLeg.id, { signedTx })); // supertest only starts on then()
    await vi.waitFor(() => expect(sends()).toBe(1));
    expect((await legs(op.id))[0]!.status).toBe("SUBMITTING");
    expect((await legs(op.id))[0]!.source_tx).toBeTruthy(); // the deterministic id is recorded before the send finished
    expect((await quote(user.h, op.id, feeLeg.id)).status).toBe(409); // cannot swap in a new transaction
    expect((await cancel(user.h, op.id)).status).toBe(409); // cannot cancel under a signed transaction in flight
    expect((await submit(user.h, op.id, feeLeg.id, { signedTx })).status).toBe(409); // a second tab cannot send it again
    release();
    expect((await first).body.legs[0].status).toBe("SUBMITTED");
    expect(sends()).toBe(1);
    expect((await opRow(op.id)).status).toBe("IN_PROGRESS");
  });

  it("I2: a transaction id belongs to one leg", async () => {
    const { op } = await ready();
    const [a, b] = await adminSql<{ id: string }[]>`SELECT id FROM app.operation_legs WHERE operation_id = ${op.id} ORDER BY sequence LIMIT 2`;
    await adminSql`UPDATE app.operation_legs SET source_tx = 'same-sig' WHERE id = ${a!.id}`;
    await expect(adminSql`UPDATE app.operation_legs SET source_tx = 'same-sig' WHERE id = ${b!.id}`).rejects.toThrow(/operation_legs_source_tx/);
  });

  it("I2: a plan with a claimed leg does not expire out from under it", async () => {
    const { user, basket, op } = await ready();
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTING', source_tx = 'sig-claimed' WHERE id = ${op.legs[0].id}`;
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 minute' WHERE id = ${op.id}`;
    expect((await invest(user.h, basket.basketId, { idempotencyKey: "key-zzzzzzzz" })).body.error.code).toBe("OPERATION_IN_PROGRESS");
    expect((await opRow(op.id)).status).toBe("PLANNED");
  });

  it("D3: cancelling a plan releases its unspent gas reservation, so going Back repeatedly does not burn the day's budget", async () => {
    const { user, basket } = await arrange();
    for (const key of ["key-back0001", "key-back0002", "key-back0003", "key-back0004"]) {
      const op = (await invest(user.h, basket.basketId, { idempotencyKey: key })).body;
      expect(await usage()).toBe(40_000n);
      expect((await cancel(user.h, op.id)).body.status).toBe("CANCELLED");
      expect(await usage()).toBe(0n);
    }
    expect((await adminSql<{ gas_reserved: object }[]>`SELECT gas_reserved FROM app.operations LIMIT 1`)[0]!.gas_reserved).toEqual({});
  });

  it("D3: an expired plan releases its reservation when it is next touched", async () => {
    const { user, basket } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 minute' WHERE id = ${op.id}`;
    expect((await invest(user.h, basket.basketId, { idempotencyKey: "key-after001" })).status).toBe(201);
    expect(await usage()).toBe(40_000n); // only the new plan's
  });

  it("I6/D6: a fresh quote below the plan's minimum is a 409 PRICE_MOVED and nothing is stored; a better one passes", async () => {
    const { user, op, feeLeg, solLeg, chain } = await ready();
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${feeLeg.id}`;
    chain.quoteOut = { numerator: 99n, denominator: 100n }; // 1% worse
    const res = await quote(user.h, op.id, solLeg.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRICE_MOVED");
    expect((await legs(op.id))[1]!.built_message_hash).toBeNull();
    chain.quoteOut = { numerator: 101n, denominator: 100n };
    const better = await quote(user.h, op.id, solLeg.id);
    expect(better.status).toBe(200);
    expect(BigInt(better.body.minOut)).toBeGreaterThan(BigInt(op.legs[1].minOut)); // the user is shown the fresh figures
    expect((await legs(op.id))[1]!.min_out).toBe(op.legs[1].minOut); // the plan's own minimum is not loosened by quoting
  });

  it("I4: a provider transaction in which the fee payer would pay for anything but fees and token-account rent is refused at quote time", async () => {
    const { user, op, feeLeg, solLeg, chain } = await ready();
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${feeLeg.id}`;
    const { lifi } = await import("../../src/providers/routes/lifi");
    const { feePayer } = await import("../../src/providers/solana-tx");
    const { PublicKey, SystemProgram, TransactionMessage } = await import("@solana/web3.js");
    const good = lifi.quote as unknown as (i: unknown) => Promise<{ transaction: { kind: string } }>;
    const original = vi.mocked(lifi.quote).getMockImplementation()!;
    vi.mocked(lifi.quote).mockImplementation(async (i) => {
      const q = await original(i);
      const drain = new VersionedTransaction(new TransactionMessage({ payerKey: feePayer().publicKey, recentBlockhash: bs58.encode(Buffer.alloc(32, 9)), instructions: [SystemProgram.transfer({ fromPubkey: feePayer().publicKey, toPubkey: new PublicKey(Buffer.alloc(32, 4)), lamports: 1_000_000n })] }).compileToV0Message());
      return { ...q, transaction: { kind: "solana", serializedBase64: Buffer.from(drain.serialize()).toString("base64") } };
    });
    void good; void chain;
    const res = await quote(user.h, op.id, solLeg.id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect((await legs(op.id))[1]!.built_message_hash).toBeNull();
  });

  it("spec 7: a plan is refused while the platform fee payer cannot fund it, before any row exists", async () => {
    const { user, basket, chain } = await arrange();
    const { feePayer } = await import("../../src/providers/solana-tx");
    chain.balances.set(balanceKey(feePayer().publicKey.toBase58(), null), 1_000n);
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(0);
    expect(await usage()).toBe(0n);
  });

  it("D2: the user may stop while a leg is UNKNOWN: PARTIAL, which frees the slot", async () => {
    const { user, basket } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${op.legs[0].id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'UNKNOWN', source_tx = 'sig-u' WHERE id = ${op.legs[1].id}`;
    const res = await cancel(user.h, op.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PARTIAL");
    expect((await invest(user.h, basket.basketId, { idempotencyKey: "key-new00001" })).status).toBe(201);
  });
});
