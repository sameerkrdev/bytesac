import { VersionedTransaction } from "@solana/web3.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOL_BUFFER_LAMPORTS } from "@repo/validator";
import { app } from "@/app";
import { env } from "@/config/dotenv";
import { connection, feePayer, FEE_TRANSFER_USER_LAMPORTS, TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/providers/solana-tx";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { trackLeg } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { balanceKey, mockChains, solanaTestWallet } from "../../helpers/chain-mocks";
import { USDC_MINT, chargeEntryFee, seedBasket, seedPosition, seedPrices, seedUser, type SeedAsset } from "../../helpers/execution";

// The revenue treasury address is switchable per test (the parsed env is read-only).
const revenue = vi.hoisted(() => ({ address: "" }));
vi.mock("@/config/dotenv", async (original) => {
  const m = await original<typeof import("@/config/dotenv")>();
  return { ...m, env: new Proxy({} as typeof m.env, { get: (_, k) => (k === "REVENUE_TREASURY_SOLANA_ADDRESS" ? revenue.address : Reflect.get(m.env, k)) }) };
});

// Spec 22 B-03: the user pays Solana gas in SOL on every new leg. Legs planned with the platform as fee payer keep the co-sign path.

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 3000 };
const BTC: SeedAsset = { symbol: "BTC", chain: "bitcoin", bps: 2000 };
type H = Record<string, string>;

const sends = () => vi.mocked(connection.sendRawTransaction).mock.calls.length;
const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const invest = (h: H, basketId: string, over: object = {}) => post(h, "/v1/operations/invest", { basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa", ...over });
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const submit = (h: H, opId: string, legId: string, body: object) => post(h, `/v1/operations/${opId}/legs/${legId}/submit`, body);
const legRows = (opId: string) => adminSql<{ id: string; sequence: number; kind: string; status: string; gas_payer: string; amount_in: string; fee_share: Record<string, string> | null; fee_covered_by: string | null; expected_tx: Record<string, string> | null }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;

const SOL_HELD = 10n ** 9n;
/** 1 signature at 5 000 lamports: what the mocked LI.FI transaction costs its fee payer (the mock's `gasNative` is 5 000 as well). */
const LEG_LAMPORTS = 5_000n;

async function arrange(over: { bps?: number; sol?: bigint; assets?: SeedAsset[] } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const wallet = solanaTestWallet();
  const basket = await seedBasket({ assets: over.assets ?? [SOL, ETH, BTC] });
  const payout = over.bps === 0 ? null : await chargeEntryFee(basket, over.bps ?? 100);
  const user = await seedUser({ wallet, bitcoin: true });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
  chain.balances.set(balanceKey(user.solanaAddress, null), over.sol ?? SOL_HELD);
  return { chain, wallet, basket, user, payout };
}

/** The wallet's step: it signs the transaction it was shown; the user is the only signer. */
const sign = (serializedBase64: string, wallet: ReturnType<typeof solanaTestWallet>, edit?: (tx: VersionedTransaction) => void) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64"));
  edit?.(tx);
  tx.sign([wallet.keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
};

beforeEach(async () => { revenue.address = ""; await resetDb(); });
afterEach(() => vi.restoreAllMocks());

describe("invest plan with user-paid gas", () => {
  it("quotes without svmSponsor, marks every leg user_solana, reserves nothing and states the SOL requirement", async () => {
    const { basket, user, chain } = await arrange();
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    expect(chain.quotes.length).toBeGreaterThan(0);
    expect(chain.quotes.every((q) => q.svmSponsor === undefined)).toBe(true);
    expect(res.body.legs.every((l: { gasPayer: string }) => l.gasPayer === "user_solana")).toBe(true);
    expect(res.body.networkFeeUsdc).toBe("0");
    expect(await adminSql`SELECT 1 FROM app.sponsor_usage`).toHaveLength(0);
    expect((await adminSql<{ gas_reserved: object }[]>`SELECT gas_reserved FROM app.operations`)[0]!.gas_reserved).toEqual({});
    // fee transfer + 3 Solana legs + the manager's token account (missing, so the user funds its rent) + the buffer
    const expected = FEE_TRANSFER_USER_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS + 3n * LEG_LAMPORTS + SOL_BUFFER_LAMPORTS;
    expect(res.body.solRequiredLamports).toBe(expected.toString());
    expect(res.body.approvalsEstimate).toBe(4); // single tier: one popup per transaction, the fee included
    const legs = await legRows(res.body.id);
    expect(legs.filter((l) => l.kind !== "network_fee").every((l) => l.expected_tx?.userLamports === LEG_LAMPORTS.toString())).toBe(true);
  });

  it("is refused with SOL_REQUIRED when the wallet holds too little SOL, and stores nothing", async () => {
    const { basket, user, chain } = await arrange();
    const first = (await invest(user.h, basket.basketId)).body;
    await post(user.h, `/v1/operations/${first.id}/cancel`);
    chain.balances.set(balanceKey(user.solanaAddress, null), 0n);
    const res = await invest(user.h, basket.basketId, { idempotencyKey: "key-bbbbbbbb" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SOL_REQUIRED");
    expect(res.body.error.details).toEqual({ lamportsRequired: first.solRequiredLamports, lamportsHeld: "0" });
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(1); // only the cancelled first plan
  });

  it("splits each fee kind over the asset legs by amountIn, the remainder to the largest, and charges the total on one fee leg paid by the user", async () => {
    const { basket, user, wallet } = await arrange();
    const res = await invest(user.h, basket.basketId, { amountUsdc: "333.333333" });
    expect(res.status).toBe(201);
    // fee 1% of 333.333333 = 3 333 333; deployable 330 000 000 split 50/30/20; floor shares 1 666 666 / 999 999 / 666 666, the 2 left over go to the 50% leg
    const [feeLeg, ...assets] = await legRows(res.body.id);
    expect(feeLeg).toMatchObject({ kind: "network_fee", amount_in: "3333333", gas_payer: "user_solana" });
    expect(assets.map((l) => l.amount_in)).toEqual(["165000000", "99000000", "66000000"]);
    expect(assets.map((l) => l.fee_share?.manager_entry)).toEqual(["1666668", "999999", "666666"]);
    expect(assets.reduce((t, l) => t + BigInt(l.fee_share!.manager_entry!), 0n)).toBe(3_333_333n);
    const q = await quote(user.h, res.body.id, feeLeg!.id);
    const tx = VersionedTransaction.deserialize(Buffer.from(q.body.transaction.serializedBase64, "base64"));
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(user.solanaAddress);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(sign(q.body.transaction.serializedBase64, wallet)).toBeTruthy();
  });

  it("plans without a fee leg when nothing is charged", async () => {
    const { basket, user } = await arrange({ bps: 0 });
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    expect(res.body.legs.map((l: { kind: string }) => l.kind)).toEqual(["swap", "cross_chain", "cross_chain"]);
    expect(res.body.fees.every((f: { amountMicro: string }) => f.amountMicro === "0")).toBe(true);
    expect(BigInt(res.body.solRequiredLamports)).toBe(3n * LEG_LAMPORTS + SOL_BUFFER_LAMPORTS);
  });
});

describe("per-leg quote and submit, user-paid", () => {
  async function planned() {
    const ctx = await arrange();
    const op = (await invest(ctx.user.h, ctx.basket.basketId)).body;
    return { ...ctx, op, feeLeg: op.legs[0], solLeg: op.legs[1] };
  }

  it("verifies the user's signature, sends it as it is and adds no platform signature", async () => {
    const { user, wallet, op, feeLeg } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    const res = await submit(user.h, op.id, feeLeg.id, { signedTx: sign(q.body.transaction.serializedBase64, wallet) });
    expect(res.status).toBe(200);
    expect(sends()).toBe(1);
    const sent = VersionedTransaction.deserialize(vi.mocked(connection.sendRawTransaction).mock.calls[0]![0] as Uint8Array);
    expect(sent.signatures).toHaveLength(1);
    expect(sent.message.staticAccountKeys[0]!.toBase58()).toBe(user.solanaAddress);
    expect(res.body.legs[0].sourceTx).toBeTruthy();
  });

  it("refuses a different fee payer or a changed transfer with TX_MISMATCH and sends nothing; a ComputeBudget-only rewrite is accepted", async () => {
    const { user, wallet, op, feeLeg, chain } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    const prepared = q.body.transaction.serializedBase64 as string;

    // The platform as fee payer: index 0 is not the user's.
    const tx = VersionedTransaction.deserialize(Buffer.from(prepared, "base64"));
    tx.message.staticAccountKeys[0] = feePayer().publicKey;
    const swapped = await submit(user.h, op.id, feeLeg.id, { signedTx: Buffer.from(tx.serialize()).toString("base64") });
    expect(swapped.status).toBe(409);
    expect(swapped.body.error.code).toBe("TX_MISMATCH");

    // A transfer whose amount changed after the quote.
    const changed = sign(prepared, wallet, (tx) => {
      const transfer = tx.message.compiledInstructions.find((ix) => ix.data[0] === 12)!;
      transfer.data[1] = (transfer.data[1]! + 1) % 256;
    });
    const edited = await submit(user.h, op.id, feeLeg.id, { signedTx: changed });
    expect(edited.status).toBe(409);
    expect(edited.body.error.code).toBe("TX_MISMATCH");
    expect(sends()).toBe(0);
    expect((await legRows(op.id))[0]!.status).toBe("PLANNED");

    // A wallet raising the priority fee (ComputeBudget only) is accepted.
    const padded = sign(prepared, wallet, (tx) => {
      const price = tx.message.compiledInstructions.find((ix) => ix.data[0] === 3)!;
      price.data[1] = (price.data[1]! + 1) % 256;
    });
    const ok = await submit(user.h, op.id, feeLeg.id, { signedTx: padded });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(sends()).toBe(1);
    expect(chain.broadcasts).toHaveLength(0);
  });

  it("a signature that does not verify is refused", async () => {
    const { user, op, feeLeg } = await planned();
    const q = await quote(user.h, op.id, feeLeg.id);
    const unsigned = await submit(user.h, op.id, feeLeg.id, { signedTx: q.body.transaction.serializedBase64 });
    expect(unsigned.status).toBe(409);
    expect(unsigned.body.error.code).toBe("TX_MISMATCH");
    expect(sends()).toBe(0);
  });
});

describe("legs planned before user-paid gas", () => {
  it("a platform_fee_payer leg still quotes with svmSponsor, builds a platform-paid transaction and is co-signed", async () => {
    const { user, wallet, basket, chain } = await arrange();
    const op = (await invest(user.h, basket.basketId)).body;
    await adminSql`UPDATE app.operation_legs SET gas_payer = 'platform_fee_payer' WHERE operation_id = ${op.id}`;
    const fee = await quote(user.h, op.id, op.legs[0].id);
    const feeTx = VersionedTransaction.deserialize(Buffer.from(fee.body.transaction.serializedBase64, "base64"));
    expect(feeTx.message.staticAccountKeys[0]!.equals(feePayer().publicKey)).toBe(true);
    await submit(user.h, op.id, op.legs[0].id, { signedTx: sign(fee.body.transaction.serializedBase64, wallet) });
    const sent = VersionedTransaction.deserialize(vi.mocked(connection.sendRawTransaction).mock.calls[0]![0] as Uint8Array);
    expect(sent.signatures).toHaveLength(2); // the platform co-signed
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${op.legs[0].id}`;
    const swap = await quote(user.h, op.id, op.legs[1].id);
    expect(swap.status).toBe(200);
    expect(chain.quotes.at(-1)!.svmSponsor).toBe(feePayer().publicKey.toBase58());
  });
});

describe("fee charges", () => {
  async function feeLegSent() {
    const ctx = await arrange();
    vi.spyOn(connection, "getParsedTransaction").mockResolvedValue({ blockTime: Date.parse("2026-09-10T12:00:00Z") / 1000 } as never);
    const op = (await invest(ctx.user.h, ctx.basket.basketId)).body;
    const feeLeg = op.legs[0];
    const q = await quote(ctx.user.h, op.id, feeLeg.id);
    const sent = await submit(ctx.user.h, op.id, feeLeg.id, { signedTx: sign(q.body.transaction.serializedBase64, ctx.wallet) });
    ctx.chain.solanaFinality.set(sent.body.legs[0].sourceTx, "finalized");
    return { ...ctx, op, feeLeg };
  }

  it("settling the plan's fee leg writes one charge per charged kind, covers every asset leg and stamps the plan rows", async () => {
    const { op, feeLeg } = await feeLegSent();
    await trackLeg(feeLeg.id);
    const charges = await adminSql<{ kind: string; amount_micro: string; fee_leg_id: string; settled_at: Date | null; settled_chain_at: Date | null }[]>`
      SELECT f.kind, c.amount_micro, c.fee_leg_id, c.settled_at, c.settled_chain_at FROM app.operation_fee_charges c JOIN app.operation_fees f ON f.id = c.operation_fee_id WHERE f.operation_id = ${op.id}`;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ kind: "manager_entry", amount_micro: "5000000", fee_leg_id: feeLeg.id });
    expect(charges[0]!.settled_at).toBeTruthy();
    expect(charges[0]!.settled_chain_at?.toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect((await legRows(op.id)).filter((l) => l.kind !== "network_fee").every((l) => l.fee_covered_by === feeLeg.id)).toBe(true);
    expect(await adminSql`SELECT 1 FROM app.operation_fees WHERE operation_id = ${op.id} AND amount_micro::numeric > 0 AND settled_at IS NULL`).toHaveLength(0);
  });

  it("a second settle does not charge twice", async () => {
    const { feeLeg } = await feeLegSent();
    await trackLeg(feeLeg.id);
    await trackLeg(feeLeg.id);
    expect(await adminSql`SELECT 1 FROM app.operation_fee_charges`).toHaveLength(1);
  });
});

describe("sell with only Solana legs", () => {
  it("is user-paid: no Solana reservation, the SOL requirement includes the fee transaction, and a missing SOL balance is refused", async () => {
    revenue.address = solanaTestWallet().address;
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [{ symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 10_000, decimals: 6 }] });
    await adminSql`INSERT INTO app.platform_fee_schedules (id, scope, operation_kind, bps, reason, created_by) VALUES (gen_random_uuid(), 'default', 'sell_to_usdc', 25, 'test', ${basket.ownerId})`;
    const user = await seedUser({ wallet: solanaTestWallet() });
    await seedPrices(basket.deployments, ["2"]);
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 100_000_000n }]);
    chain.balances.set(balanceKey(user.solanaAddress, basket.deployments[0]!.address), 100_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 50_000_000n);
    const body = { positionId, percent: 100, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa" };

    chain.balances.set(balanceKey(user.solanaAddress, null), 0n);
    const refused = await post(user.h, "/v1/operations/sell", body);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("SOL_REQUIRED");

    chain.balances.set(balanceKey(user.solanaAddress, null), SOL_HELD);
    const res = await post(user.h, "/v1/operations/sell", body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.legs.map((l: { kind: string; gasPayer: string }) => [l.kind, l.gasPayer])).toEqual([["network_fee", "user_solana"], ["swap", "user_solana"]]);
    expect(res.body.networkFeeUsdc).toBe("0");
    expect(res.body.fees.find((f: { kind: string }) => f.kind === "platform").amountMicro).toBe("500000");
    expect(await adminSql`SELECT 1 FROM app.sponsor_usage`).toHaveLength(0);
    // The fee transaction (its own signature, priority fee and the revenue treasury's missing token account), the sell and the buffer.
    expect(BigInt(res.body.solRequiredLamports)).toBe(FEE_TRANSFER_USER_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS + LEG_LAMPORTS + SOL_BUFFER_LAMPORTS);
    expect(env.REVENUE_TREASURY_SOLANA_ADDRESS).toBe(revenue.address);
  });
});
