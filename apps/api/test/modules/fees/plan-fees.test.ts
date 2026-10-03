import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { env } from "@/config/dotenv";
import { lifi } from "@/providers/routes/lifi";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { trackLeg } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "../../helpers/chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "../../helpers/execution";

// The revenue treasury address is switchable per test (the parsed env is read-only).
const revenue = vi.hoisted(() => ({ address: "" }));
vi.mock("@/config/dotenv", async (original) => {
  const m = await original<typeof import("@/config/dotenv")>();
  return { ...m, env: new Proxy({} as typeof m.env, { get: (_, k) => (k === "REVENUE_TREASURY_SOLANA_ADDRESS" ? revenue.address : Reflect.get(m.env, k)) }) };
});

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const TKN: SeedAsset = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000, decimals: 18 };
type H = Record<string, string>;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const ata = (owner: string) => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), new PublicKey(USDC_MINT).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();

const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const invest = (h: H, basketId: string, over: object = {}) => post(h, "/v1/operations/invest", { basketId, amountUsdc: "1000", slippageBps: 100, idempotencyKey: "key-aaaaaaaa", ...over });
const rebalance = (h: H, positionId: string, over: object = {}) => post(h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa", ...over });
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const feeRows = (opId: string) => adminSql<{ kind: string; amount_micro: string; base_micro: string; recipient_address: string | null; waived_reason: string | null; settled_at: Date | null; leg_id: string }[]>`
  SELECT * FROM app.operation_fees WHERE operation_id = ${opId} ORDER BY array_position(array['network','manager_entry','manager_rebalance','platform']::text[], kind::text)`;
const legsOf = (opId: string) => adminSql<{ id: string; kind: string; amount_in: string; route_summary: { fromCash?: boolean } | null }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;

/** The recipients and amounts of the fee transaction: every token transfer and every CreateIdempotent. */
function decode(serializedBase64: string) {
  const m = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  const keys = m.staticAccountKeys.map((k) => k.toBase58());
  const ix = m.compiledInstructions.map((i) => ({ program: keys[i.programIdIndex]!, accounts: i.accountKeyIndexes.map((x) => keys[x]!), data: Buffer.from(i.data) }));
  return { keys, creates: ix.filter((i) => i.program === ATA_PROGRAM).length, transfers: ix.filter((i) => i.program === TOKEN_PROGRAM).map((i) => ({ to: i.accounts[2]!, amount: i.data.readBigUInt64LE(1) })) };
}

/** Terms for a basket: the version's manager fees, a VERIFIED payout wallet, and platform schedule rows. */
async function configure(basket: { versionId: string; owner: { id: string; userId: string } }, o: { entry?: object; rebalance?: object; schedules?: { op: string; bps: number; min?: string; max?: string }[]; payout?: boolean } = {}) {
  const fees: Record<string, unknown> = { entry: o.entry ?? { type: "percent", bps: 0 }, management: { type: "percent", bps: 0 }, rebalance: o.rebalance ?? { type: "percent", bps: 0 }, subscription: null };
  await adminSql`UPDATE app.basket_versions SET fees = ${adminSql.json(fees as never)} WHERE id = ${basket.versionId}`;
  const payout = solanaTestWallet().address;
  if (o.payout ?? true) {
    await adminSql`INSERT INTO app.organization_payout_wallets (id, organization_id, chain, address, status, requested_by_user_id, verified_at, activated_at)
      VALUES (gen_random_uuid(), ${basket.owner.id}, 'solana', ${payout}, 'VERIFIED', ${basket.owner.userId}, now(), now())`;
  }
  for (const s of o.schedules ?? []) {
    await adminSql`INSERT INTO app.platform_fee_schedules (id, scope, operation_kind, bps, min_micro, max_micro, reason, created_by)
      VALUES (gen_random_uuid(), 'default', ${s.op}, ${s.bps}, ${s.min ?? null}, ${s.max ?? null}, 'test', ${basket.owner.userId})`;
  }
  return { payout };
}

async function arrange(over: { assets?: SeedAsset[]; usdc?: bigint } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets: over.assets ?? [SOL, TKN] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 5_000_000_000n);
  return { chain, basket, user };
}

/** A position holding 10 SOL ($1,000) and 1,000 TKN ($1,000) with a newer version 2 weighing 30/70 (sell $400 of SOL, buy $400 of TKN). */
async function arrangeRebalance(over: { usdc?: bigint; assets?: SeedAsset[]; v2?: number[]; v2Fees?: object; schedules?: { op: string; bps: number; min?: string; max?: string }[] } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const assets = over.assets ?? [SOL, TKN];
  const basket = await seedBasket({ assets });
  const user = await seedUser({ wallet: solanaTestWallet() });
  const [first, second] = basket.deployments;
  await seedPrices(basket.deployments, over.assets ? ["100", "1000"] : ["100", "1"]);
  const secondQty = over.assets ? 10n ** 18n : 1_000_000_000n;
  const positionId = await seedPosition(user.userId, basket, [{ deploymentId: first!.deploymentId, quantity: 10_000_000_000n }, { deploymentId: second!.deploymentId, quantity: secondQty }]);
  chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
  if (over.assets) fakes.evm.balances.set(`ethereum:${user.evmAddress}`, secondQty);
  else chain.balances.set(balanceKey(user.solanaAddress, second!.address), secondQty);
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 50_000_000n);
  const v2 = await seedVersion(basket, 2, over.v2 ?? [3000, 7000]);
  const { payout } = await configure({ ...basket, versionId: v2 }, { rebalance: over.v2Fees ?? { type: "percent", bps: 100 }, schedules: over.schedules ?? [{ op: "rebalance_apply", bps: 25 }, { op: "rebalance_drift", bps: 25 }] });
  return { chain, basket, user, positionId, v2, payout };
}

beforeEach(async () => {
  await resetDb();
  revenue.address = solanaTestWallet().address;
});
afterEach(() => vi.restoreAllMocks());

describe("invest fees", () => {
  it("records network, manager and platform fees; one fee leg carries the total and the quote transfers to the three treasuries", async () => {
    const { basket, user } = await arrange();
    const { payout } = await configure(basket, { entry: { type: "percent", bps: 100, maxUsdc: "5" }, schedules: [{ op: "invest", bps: 25 }] });
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    const rows = await feeRows(res.body.id);
    expect(rows.map((r) => r.kind)).toEqual(["network", "manager_entry", "platform"]);
    expect(rows.map((r) => r.amount_micro).slice(1)).toEqual(["5000000", "2500000"]); // 1% capped at $5; 25 bps of $1,000
    const total = rows.reduce((s, r) => s + BigInt(r.amount_micro), 0n);
    const legs = await legsOf(res.body.id);
    expect(legs.filter((l) => l.kind === "network_fee")).toHaveLength(1);
    expect(BigInt(legs[0]!.amount_in)).toBe(total);
    expect(rows.every((r) => r.leg_id === legs[0]!.id && r.settled_at === null)).toBe(true);
    expect(res.body.fees.map((f: { kind: string; recipientLabel: string }) => [f.kind, f.recipientLabel])).toEqual([["network", "Bytesac (network)"], ["manager_entry", expect.any(String)], ["platform", "Bytesac (platform)"]]);
    // deployable = amount - total, split by weight
    expect(legs.slice(1).reduce((s, l) => s + BigInt(l.amount_in), 0n)).toBe(1_000_000_000n - total);

    const q = await quote(user.h, res.body.id, legs[0]!.id);
    expect(q.status).toBe(200);
    const tx = decode(q.body.transaction.serializedBase64);
    expect(tx.creates).toBe(3);
    expect(tx.transfers).toEqual([
      { to: ata(env.GAS_TREASURY_SOLANA_ADDRESS), amount: BigInt(rows[0]!.amount_micro) },
      { to: ata(payout), amount: 5_000_000n },
      { to: ata(revenue.address), amount: 2_500_000n },
    ]);
  });

  it("the network fee covers the token-account rent of each charged recipient and the gas reservation counts it", async () => {
    const plain = await arrange();
    const res0 = await invest(plain.user.h, plain.basket.basketId);
    const base = BigInt(res0.body.networkFeeUsdc);
    await resetDb();
    const { basket, user } = await arrange();
    await configure(basket, { entry: { type: "percent", bps: 100 }, schedules: [{ op: "invest", bps: 25 }] });
    const res = await invest(user.h, basket.basketId);
    expect(BigInt(res.body.networkFeeUsdc)).toBeGreaterThan(base);
    const [usage] = await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${user.userId} AND chain = 'solana'`;
    expect(BigInt(usage!.amount_native)).toBeGreaterThanOrEqual(2n * 2_039_280n);
  });

  it("no rent is charged for a recipient whose token account already exists", async () => {
    const plain = await arrange();
    const base = BigInt((await invest(plain.user.h, plain.basket.basketId)).body.networkFeeUsdc);
    await resetDb();
    revenue.address = solanaTestWallet().address;
    const { basket, user, chain } = await arrange();
    const { payout } = await configure(basket, { entry: { type: "percent", bps: 100 }, schedules: [{ op: "invest", bps: 25 }] });
    chain.tokenAccounts.add(ata(payout));
    chain.tokenAccounts.add(ata(revenue.address));
    const res = await invest(user.h, basket.basketId);
    expect(BigInt(res.body.networkFeeUsdc)).toBe(base);
    const [usage] = await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${user.userId} AND chain = 'solana'`;
    expect(BigInt(usage!.amount_native)).toBeLessThan(2_039_280n);
  });

  it("a pre-Spec-10 operation (no fee rows) quotes one transfer of the leg amount to the gas treasury, shows one network fee and settles", async () => {
    const { basket, user, chain } = await arrange();
    const res = await invest(user.h, basket.basketId);
    await adminSql`DELETE FROM app.operation_fees WHERE operation_id = ${res.body.id}`;
    const leg = (await legsOf(res.body.id))[0]!;
    const q = await quote(user.h, res.body.id, leg.id);
    expect(q.status).toBe(200);
    expect(decode(q.body.transaction.serializedBase64).transfers).toEqual([{ to: ata(env.GAS_TREASURY_SOLANA_ADDRESS), amount: BigInt(leg.amount_in) }]);
    const view = await request(app).get(`/v1/operations/${res.body.id}`).set(user.h);
    expect(view.body.fees).toEqual([{ kind: "network", amountMicro: res.body.networkFeeUsdc, waivedReason: null, recipientLabel: "Bytesac (network)" }]);
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${res.body.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-legacy', submitted_at = now() WHERE id = ${leg.id}`;
    chain.solanaFinality.set("sig-legacy", "finalized");
    await trackLeg(leg.id);
    expect((await legsOf(res.body.id))[0]).toMatchObject({ status: "SETTLED" });
  });

  it("fee rows that don't add up to the fee leg are ROUTE_UNAVAILABLE and nothing is built", async () => {
    const { basket, user } = await arrange();
    const res = await invest(user.h, basket.basketId);
    await adminSql`UPDATE app.operation_fees SET amount_micro = amount_micro::bigint + 1 WHERE operation_id = ${res.body.id}`;
    const q = await quote(user.h, res.body.id, (await legsOf(res.body.id))[0]!.id);
    expect(q.status).toBe(503);
    expect(q.body.error.code).toBe("ROUTE_UNAVAILABLE");
  });

  it("an amount whose fees leave nothing to invest is VALIDATION_FAILED", async () => {
    const { basket, user } = await arrange();
    await configure(basket, { entry: { type: "fixed", amountUsdc: "1" }, schedules: [{ op: "invest", bps: 100, min: "100" }] });
    await adminSql`UPDATE app.basket_versions SET minimum_investment_usdc = '1' WHERE id = ${basket.versionId}`;
    const res = await invest(user.h, basket.basketId, { amountUsdc: "1" }); // manager $1 + platform min $100 + network
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_FAILED", message: "The amount doesn't cover the fees." });
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(0);
  });

  it("a schedule edited after the plan was made does not change the signed amounts", async () => {
    const { basket, user } = await arrange();
    const { payout } = await configure(basket, { schedules: [{ op: "invest", bps: 25 }] });
    const res = await invest(user.h, basket.basketId);
    await adminSql`UPDATE app.platform_fee_schedules SET superseded_at = now()`;
    await adminSql`INSERT INTO app.platform_fee_schedules (id, scope, operation_kind, bps, reason, created_by) VALUES (gen_random_uuid(), 'default', 'invest', 100, 'raised', ${basket.ownerId})`;
    const legs = await legsOf(res.body.id);
    const tx = decode((await quote(user.h, res.body.id, legs[0]!.id)).body.transaction.serializedBase64);
    expect(tx.transfers.at(-1)).toEqual({ to: ata(revenue.address), amount: 2_500_000n });
    expect(tx.transfers.some((t) => t.to === ata(payout))).toBe(false);
  });

  it("a revoked payout wallet waives the manager fee (no transfer to it) and the owner is told once per day", async () => {
    const { basket, user } = await arrange();
    const { payout } = await configure(basket, { entry: { type: "percent", bps: 100 } });
    await adminSql`UPDATE app.organization_payout_wallets SET status = 'REVOKED'`;
    const first = await invest(user.h, basket.basketId);
    const rows = await feeRows(first.body.id);
    expect(rows.map((r) => [r.kind, r.amount_micro, r.waived_reason])).toEqual([["network", expect.any(String), null], ["manager_entry", "0", "payout_wallet_unavailable"]]);
    const tx = decode((await quote(user.h, first.body.id, (await legsOf(first.body.id))[0]!.id)).body.transaction.serializedBase64);
    expect(tx.transfers.map((t) => t.to)).toEqual([ata(env.GAS_TREASURY_SOLANA_ADDRESS)]);
    expect(tx.transfers.some((t) => t.to === ata(payout))).toBe(false);
    await adminSql`UPDATE app.operations SET status = 'CANCELLED'`;
    await invest(user.h, basket.basketId, { idempotencyKey: "key-bbbbbbbb" });
    // Resend dedupes on the key: both plans send the same one for the organization and the UTC day.
    const waived = fakes.email.organization.filter((e) => e.kind === "fee_waived");
    expect(new Set(waived.map((e) => e.idempotencyKey)).size).toBe(1);
    expect(waived[0]!.idempotencyKey).toBe(`fee-waived/${basket.owner.id}/${new Date().toISOString().slice(0, 10)}`);
  });

  it("a fee below 0.01 USDC is recorded as dust and not transferred", async () => {
    const { basket, user } = await arrange();
    await configure(basket, { schedules: [{ op: "invest", bps: 25, max: "5000" }] }); // capped at 0.005 USDC
    const res = await invest(user.h, basket.basketId);
    const rows = await feeRows(res.body.id);
    expect(rows.map((r) => [r.kind, r.amount_micro, r.waived_reason])).toEqual([["network", expect.any(String), null], ["platform", "0", "dust"]]);
    expect(decode((await quote(user.h, res.body.id, (await legsOf(res.body.id))[0]!.id)).body.transaction.serializedBase64).transfers).toHaveLength(1);
  });

  it("no manager or platform fee: exactly one transfer, as before", async () => {
    const { basket, user } = await arrange();
    const res = await invest(user.h, basket.basketId);
    expect(res.body.fees.map((f: { kind: string }) => f.kind)).toEqual(["network"]);
    expect(decode((await quote(user.h, res.body.id, (await legsOf(res.body.id))[0]!.id)).body.transaction.serializedBase64).transfers).toHaveLength(1);
  });

  it("a platform fee without a revenue treasury is ROUTE_UNAVAILABLE", async () => {
    const { basket, user } = await arrange();
    await configure(basket, { schedules: [{ op: "invest", bps: 25 }] });
    revenue.address = "";
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
  });

  it("a fee transaction with a changed recipient is TX_MISMATCH at submit and nothing is sent", async () => {
    const { basket, user } = await arrange();
    const { payout } = await configure(basket, { entry: { type: "percent", bps: 100 } });
    const res = await invest(user.h, basket.basketId);
    const leg = (await legsOf(res.body.id))[0]!;
    const q = await quote(user.h, res.body.id, leg.id);
    const tx = VersionedTransaction.deserialize(Buffer.from(q.body.transaction.serializedBase64, "base64"));
    const victim = tx.message.staticAccountKeys.findIndex((k) => k.toBase58() === ata(payout));
    tx.message.staticAccountKeys[victim] = new PublicKey(ata(solanaTestWallet().address)); // the manager's token account swapped for an attacker's
    const res2 = await post(user.h, `/v1/operations/${res.body.id}/legs/${leg.id}/submit`, { signedTx: Buffer.from(tx.serialize()).toString("base64") });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("TX_MISMATCH");
  });

  it("settlement stamps every charged fee when the fee leg settles; a failed fee leg stamps none", async () => {
    const run = async (finality: "finalized" | "failed") => {
      const { basket, user, chain } = await arrange();
      await configure(basket, { entry: { type: "percent", bps: 100 }, schedules: [{ op: "invest", bps: 25 }] });
      const res = await invest(user.h, basket.basketId);
      const leg = (await legsOf(res.body.id))[0]!;
      await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${res.body.id}`;
      await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-fee', submitted_at = now() WHERE id = ${leg.id}`;
      chain.solanaFinality.set("sig-fee", finality);
      await trackLeg(leg.id);
      return (await feeRows(res.body.id)).map((r) => r.settled_at !== null);
    };
    expect(await run("finalized")).toEqual([true, true, true]);
    await resetDb();
    revenue.address = solanaTestWallet().address;
    expect(await run("failed")).toEqual([false, false, false]);
  });
});

describe("rebalance fees", () => {
  it("apply latest with free USDC: manager and platform fees on the traded value, fee leg first", async () => {
    const { user, positionId, payout } = await arrangeRebalance();
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(201);
    const rows = await feeRows(res.body.id);
    // traded value T = $400 sold + min(cash $0, buys) = $400: manager 1% = $4, platform 25 bps = $1
    expect(rows.map((r) => [r.kind, r.base_micro, r.amount_micro]).slice(1)).toEqual([["manager_rebalance", "400000000", "4000000"], ["platform", "400000000", "1000000"]]);
    const legs = await legsOf(res.body.id);
    expect(legs.map((l) => l.kind)).toEqual(["network_fee", "swap", "swap"]);
    expect(BigInt(legs[0]!.amount_in)).toBe(rows.reduce((s, r) => s + BigInt(r.amount_micro), 0n));
    const tx = decode((await quote(user.h, res.body.id, legs[0]!.id)).body.transaction.serializedBase64);
    expect(tx.transfers.map((t) => t.to)).toEqual([ata(env.GAS_TREASURY_SOLANA_ADDRESS), ata(payout), ata(revenue.address)]);
  });

  it("no free USDC and Solana-only sells: the whole fee block goes between sells and buys, paid from basket cash", async () => {
    const { user, positionId } = await arrangeRebalance({ usdc: 0n });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(201);
    const legs = await legsOf(res.body.id);
    expect(legs.map((l) => l.kind)).toEqual(["swap", "network_fee", "swap"]);
    expect(legs[1]!.route_summary).toEqual({ fromCash: true });
    const total = (await feeRows(res.body.id)).reduce((s, r) => s + BigInt(r.amount_micro), 0n);
    expect(BigInt(legs[1]!.amount_in)).toBe(total);
    expect(BigInt(legs[2]!.amount_in)).toBe(400_000_000n - total);
  });

  it("an EVM sell without free USDC is INSUFFICIENT_BALANCE and names the total", async () => {
    const { user, positionId } = await arrangeRebalance({ assets: [SOL, ETH], v2: [7000, 3000], usdc: 0n });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
    expect(res.body.error.message).toMatch(/Add at least \$\d+\.\d\d USDC on Solana to pay the fees before selling assets on Ethereum/);
    expect(BigInt(res.body.error.details.requiredUsdc)).toBeGreaterThan(5_000_000n); // network + $4 + $1
  });

  it("a drift fix (applied version) charges no manager fee, only the rebalance_drift platform fee", async () => {
    const { user, positionId, basket } = await arrangeRebalance({ v2: [3000, 7000] });
    // make v2 the position's applied version: it is current, so "applied" is allowed
    await adminSql`UPDATE app.basket_positions SET applied_version_id = ${(await adminSql<{ current_version_id: string }[]>`SELECT current_version_id FROM app.baskets WHERE id = ${basket.basketId}`)[0]!.current_version_id} WHERE id = ${positionId}`;
    const res = await rebalance(user.h, positionId, { target: "applied" });
    expect(res.status).toBe(201);
    expect((await feeRows(res.body.id)).map((r) => r.kind)).toEqual(["network", "platform"]);
  });
});

describe("repair and sell fees", () => {
  it("repair: platform fee on the buy cost, no manager fee, and the free-USDC check includes it", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [{ symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", decimals: 6, bps: 10_000 }] });
    await configure(basket, { entry: { type: "percent", bps: 100 }, rebalance: { type: "percent", bps: 100 }, schedules: [{ op: "repair", bps: 25, min: "20000" }] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    const d = basket.deployments[0]!;
    await seedPrices([d], ["1"]);
    await seedPosition(user.userId, basket, [{ deploymentId: d.deploymentId, quantity: 15n }]);
    fakes.evm.balances.set(`ethereum:${user.evmAddress}:${d.address}`, 10n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 50_000_000n);
    const repair = (usdc: bigint) => { chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), usdc); return post(user.h, "/v1/operations/repair", { deploymentId: d.deploymentId, slippageBps: 100, idempotencyKey: "rep-aaaaaaaa" }); };
    const tight = await repair(100_000n); // not enough for network + platform minimum + the buy
    expect(tight.body.error.code).toBe("INSUFFICIENT_BALANCE");
    const res = await repair(50_000_000n);
    expect(res.status).toBe(201);
    const rows = await feeRows(res.body.id);
    expect(rows.map((r) => [r.kind, r.amount_micro]).slice(1)).toEqual([["platform", "20000"]]); // 25 bps of 6 micro-USDC is 0; the minimum applies
    expect(rows[1]!.base_micro).toBe((await legsOf(res.body.id))[1]!.amount_in);
  });

  it("sell 50%: platform fee on the planned sale value, no manager fee; no price waives it as no_price", async () => {
    const mk = async (priced: boolean) => {
      const chain = mockChains();
      await seedPlatformWallets();
      const basket = await seedBasket({ assets: [SOL] });
      await configure(basket, { entry: { type: "percent", bps: 100 }, schedules: [{ op: "sell_to_usdc", bps: 25 }] });
      const user = await seedUser({ wallet: solanaTestWallet() });
      if (priced) await seedPrices(basket.deployments, ["100"]);
      const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 4_000_000_000n }]);
      chain.balances.set(balanceKey(user.solanaAddress, null), 4_000_000_000n);
      chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 50_000_000n);
      return post(user.h, "/v1/operations/sell", { positionId, percent: 50, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa" });
    };
    const priced = await mk(true);
    expect((await feeRows(priced.body.id)).map((r) => [r.kind, r.base_micro, r.amount_micro]).slice(1)).toEqual([["platform", "200000000", "500000"]]); // 2 SOL x $100; 25 bps
    await resetDb();
    revenue.address = solanaTestWallet().address;
    const unpriced = await mk(false);
    expect((await feeRows(unpriced.body.id)).map((r) => [r.kind, r.amount_micro, r.waived_reason]).slice(1)).toEqual([["platform", "0", "no_price"]]);
  });
});

describe("token-account rent price", () => {
  /** EVM-sourced quotes carry the ETH price; the rent of a missing recipient account must not be priced with it. */
  const withEvmPrice = (price: number | null) => {
    const base = vi.mocked(lifi.quote).getMockImplementation()!;
    vi.mocked(lifi.quote).mockImplementation(async (i) => ({ ...(await base(i)), nativePriceUsd: i.fromChain === "solana" ? null : price }));
  };
  const networkFee = async (opId: string) => BigInt((await feeRows(opId)).find((r) => r.kind === "network")!.amount_micro);

  it("an ETH sell with a missing recipient account prices the rent at SOL's price, not ETH's", async () => {
    const run = async (price: number | null) => {
      await resetDb();
      revenue.address = solanaTestWallet().address;
      const chain = mockChains();
      withEvmPrice(price);
      await seedPlatformWallets();
      const basket = await seedBasket({ assets: [ETH] });
      await configure(basket, { schedules: [{ op: "sell_to_usdc", bps: 25 }] });
      const user = await seedUser({ wallet: solanaTestWallet() });
      await seedPrices(basket.deployments, ["3000"]);
      const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 4n * 10n ** 18n }]);
      fakes.evm.balances.set(`ethereum:${user.evmAddress}`, 4n * 10n ** 18n);
      chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 50_000_000n);
      const res = await post(user.h, "/v1/operations/sell", { positionId, percent: 50, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa" });
      expect(res.status).toBe(201);
      return networkFee(res.body.id);
    };
    expect(await run(3000)).toBe(await run(null));
  });

  it("a rebalance with an EVM sell prices the rent at SOL's price, not ETH's", async () => {
    const run = async (price: number | null) => {
      await resetDb();
      revenue.address = solanaTestWallet().address;
      const { user, positionId, chain } = await arrangeRebalance({ assets: [SOL, ETH], v2: [7000, 3000] });
      withEvmPrice(price);
      expect(chain).toBeDefined();
      const res = await rebalance(user.h, positionId);
      expect(res.status).toBe(201);
      return networkFee(res.body.id);
    };
    expect(await run(3000)).toBe(await run(null));
  });

  it("an invalid stored payout address waives the manager fee instead of crashing the plan", async () => {
    const { basket, user } = await arrange();
    await configure(basket, { entry: { type: "percent", bps: 100 } });
    await adminSql`UPDATE app.organization_payout_wallets SET address = 'not-a-solana-address'`;
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    expect((await feeRows(res.body.id)).map((r) => [r.kind, r.waived_reason])).toEqual([["network", null], ["manager_entry", "payout_wallet_unavailable"]]);
  });
});
