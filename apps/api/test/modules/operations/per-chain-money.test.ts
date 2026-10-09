import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { db } from "@repo/db";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { reconcilePositions } from "@/modules/portfolio/reconciliation.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "../../helpers/chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "../../helpers/execution";

// D-120: three EVM chains, three DIFFERENT addresses, so reading the wrong chain's address is visible.
const ADDR = { ethereum: "0x" + "bb".repeat(20), base: "0x" + "aa".repeat(20), arbitrum: "0x" + "cc".repeat(20) };
const BASE: SeedAsset = { symbol: "BASEX", chain: "base", tokenStandard: "native", bps: 5000, decimals: 18 };
const ARB: SeedAsset = { symbol: "ARBX", chain: "arbitrum", tokenStandard: "native", bps: 5000, decimals: 18 };
const ONE = 10n ** 18n;
type H = Record<string, string>;
const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const submit = (h: H, opId: string, legId: string, body: object) => post(h, `/v1/operations/${opId}/legs/${legId}/submit`, body);
const setLeg = (id: string, status: string) => adminSql`UPDATE app.operation_legs SET status = ${status} WHERE id = ${id}`;

async function arrange() {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets: [BASE, ARB] });
  const user = await seedUser({ wallet: solanaTestWallet(), evmByChain: ADDR });
  const [base, arb] = basket.deployments;
  const positionId = await seedPosition(user.userId, basket, [{ deploymentId: base!.deploymentId, quantity: 2n * ONE }, { deploymentId: arb!.deploymentId, quantity: 2n * ONE }]);
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 50_000_000n);
  for (const c of ["base", "arbitrum"]) fakes.evm.balances.set(`${c}:${fakes.evm.gasWalletAddress()}`, 10n ** 20n); // the platform gas wallet can fund these chains
  // Each chain holds its asset only at its own address; the other addresses hold decoys that must never be read.
  fakes.evm.balances.set(`base:${ADDR.base}`, 2n * ONE);
  fakes.evm.balances.set(`arbitrum:${ADDR.arbitrum}`, 2n * ONE);
  fakes.evm.balances.set(`base:${ADDR.arbitrum}`, 7n);
  fakes.evm.balances.set(`arbitrum:${ADDR.base}`, 7n);
  return { chain, basket, user, positionId, base: base!, arb: arb! };
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("userAddresses (D-120)", () => {
  it("ignores replaced and disabled rows: the active row of the chain wins; a chain with only a disabled row is CHAIN_NOT_LINKED", async () => {
    const user = await seedUser({ wallet: solanaTestWallet(), evmByChain: { base: ADDR.base, arbitrum: ADDR.arbitrum } });
    const [wallet] = await adminSql<{ id: string }[]>`SELECT id FROM app.investment_wallets WHERE user_id = ${user.userId}`;
    const [active] = await adminSql<{ id: string }[]>`SELECT id FROM app.wallet_addresses WHERE chain = 'base' AND address = ${ADDR.base}`;
    await adminSql`INSERT INTO app.wallet_addresses (id, investment_wallet_id, chain_family, chain, address, status, disabled_reason, replaced_at, replaced_by_address_id, verification_method, verified_on_chain, created_at)
      VALUES (gen_random_uuid(), ${wallet!.id}, 'evm', 'base', ${"0x" + "99".repeat(20)}, 'replaced', 'chain_reassigned', now(), ${active!.id}, 'eoa_ecdsa', 'base', now() - interval '1 day')`; // older than the active row: a missing status filter would return it
    await adminSql`UPDATE app.wallet_addresses SET status = 'disabled', disabled_reason = 'test' WHERE chain = 'arbitrum' AND address = ${ADDR.arbitrum}`;
    const addresses = await userAddresses(db, user.userId);
    expect(addressOn(addresses, "base")).toBe(ADDR.base);
    expect(addresses.arbitrum).toBeUndefined();
    expect(() => addressOn(addresses, "arbitrum")).toThrow(expect.objectContaining({ code: "CHAIN_NOT_LINKED" }));
  });
});

describe("sell with a different address per chain (D-120)", () => {
  it("sells from, drops gas to and verifies the signer against each leg's own chain address", async () => {
    const { user, positionId, chain } = await arrange();
    const r = await post(user.h, "/v1/operations/sell", { positionId, percent: 50, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa" });
    const op = r.body;
    const baseLeg = op.legs.find((l: { fromChain: string }) => l.fromChain === "base");
    const arbLeg = op.legs.find((l: { fromChain: string }) => l.fromChain === "arbitrum");
    expect([baseLeg.amountIn, arbLeg.amountIn]).toEqual([ONE.toString(), ONE.toString()]); // sized from the chain's own balance and ledger
    // plan-time quotes are asked from the asset chain's own address
    const from = (c: string) => chain.quotes.filter((q) => q.fromChain === c).map((q) => q.fromAddress);
    expect(new Set(from("base"))).toEqual(new Set([ADDR.base]));
    expect(new Set(from("arbitrum"))).toEqual(new Set([ADDR.arbitrum]));

    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    for (const l of op.legs) if (l.id !== baseLeg.id && l.id !== arbLeg.id) await setLeg(l.id, "SETTLED");
    fakes.evm.balances.clear(); // no native gas anywhere: the drop is needed
    chain.quotes.length = 0;

    const first = await quote(user.h, op.id, baseLeg.id);
    expect(fakes.evm.sentNative.map((s) => [s.chain, s.to])).toEqual([["base", ADDR.base]]);
    fakes.evm.receipts.set(first.body.gasDrop.txHash, { success: true, blockNumber: 1n, head: 2n, logs: [] });
    expect((await quote(user.h, op.id, baseLeg.id)).status).toBe(200);
    expect(chain.quotes.at(-1)).toMatchObject({ fromChain: "base", fromAddress: ADDR.base });
    const tx = { from: ADDR.base, to: "0x" + "ab".repeat(20), input: "0x1234", value: 0n, blockNumber: null };
    for (const [hash, signer] of [["0xwrong1", ADDR.arbitrum], ["0xwrong2", ADDR.ethereum]] as const) {
      fakes.evm.transactions.set(hash, { ...tx, from: signer });
      expect((await submit(user.h, op.id, baseLeg.id, { txHash: hash })).body.error.code).toBe("TX_MISMATCH");
    }
    fakes.evm.transactions.set("0xbase", tx);
    expect((await submit(user.h, op.id, baseLeg.id, { txHash: "0xbase" })).status).toBe(200);

    await setLeg(baseLeg.id, "SETTLED");
    const drop = await quote(user.h, op.id, arbLeg.id);
    expect(fakes.evm.sentNative.map((s) => [s.chain, s.to])).toEqual([["base", ADDR.base], ["arbitrum", ADDR.arbitrum]]);
    fakes.evm.receipts.set(drop.body.gasDrop.txHash, { success: true, blockNumber: 1n, head: 2n, logs: [] });
    expect((await quote(user.h, op.id, arbLeg.id)).status).toBe(200);
    expect(chain.quotes.at(-1)).toMatchObject({ fromChain: "arbitrum", fromAddress: ADDR.arbitrum });
    fakes.evm.transactions.set("0xwrong3", { ...tx, from: ADDR.base });
    expect((await submit(user.h, op.id, arbLeg.id, { txHash: "0xwrong3" })).body.error.code).toBe("TX_MISMATCH");
    fakes.evm.transactions.set("0xarb", { ...tx, from: ADDR.arbitrum });
    expect((await submit(user.h, op.id, arbLeg.id, { txHash: "0xarb" })).status).toBe(200);
  });
});

describe("rebalance with a different address per chain (D-120)", () => {
  it("quotes each sell from the asset chain's own address", async () => {
    const { user, positionId, chain, basket } = await arrange();
    await seedPrices(basket.deployments, ["1000", "1000"]);
    await seedVersion(basket, 2, [8000, 2000]); // Arbitrum is trimmed and Base bought
    const res = await post(user.h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa" });
    expect(res.status).toBe(201);
    const arbSells = chain.quotes.filter((q) => q.fromChain === "arbitrum");
    expect(arbSells.length).toBeGreaterThan(0);
    expect(new Set(arbSells.map((q) => q.fromAddress))).toEqual(new Set([ADDR.arbitrum]));
  });
});

describe("reconciliation with a different address per chain (D-120)", () => {
  it("reads each deployment's balance at its own chain's address", async () => {
    const { user, base, arb } = await arrange();
    await reconcilePositions(user.userId);
    const rows = await adminSql<{ deployment_id: string; wallet_balance: string; status: string }[]>`SELECT deployment_id, wallet_balance, status FROM app.position_reconciliations WHERE deployment_id IS NOT NULL`;
    const by = (id: string) => rows.find((r) => r.deployment_id === id);
    expect(by(base.deploymentId)).toMatchObject({ wallet_balance: (2n * ONE).toString(), status: "OK" });
    expect(by(arb.deploymentId)).toMatchObject({ wallet_balance: (2n * ONE).toString(), status: "OK" });
  });
});
