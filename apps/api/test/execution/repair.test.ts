import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { seedPlatformWallets } from "../../src/services/gas";
import { trackLeg } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedPrices, seedUser } from "./helpers";

// An ERC-20 with 6 decimals at $1, held by two baskets of one user: A records 10, B records 15, the wallet holds 10, so the shortfall is 6 and 9.
const TKN = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", decimals: 6, bps: 10_000 } as const;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
type H = Record<string, string>;

const repair = (h: H, deploymentId: string, over: object = {}) => request(app).post("/v1/operations/repair").set(h).send({ deploymentId, slippageBps: 100, idempotencyKey: "rep-aaaaaaaa", ...over });
const legsOf = (opId: string) => adminSql<{ id: string; kind: string; amount_in: string }[]>`SELECT id, kind, amount_in FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;

async function arrange(over: { usdc?: bigint; wallet?: bigint } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const [basketA, basketB] = [await seedBasket({ assets: [TKN] }), await seedBasket({ assets: [TKN] })];
  const user = await seedUser({ wallet: solanaTestWallet() });
  const shared = basketA.deployments[0]!;
  await seedPrices([shared], ["1"]);
  const pA = await seedPosition(user.userId, basketA, [{ deploymentId: shared.deploymentId, quantity: 10n }]);
  const pB = await seedPosition(user.userId, basketB, [{ deploymentId: shared.deploymentId, quantity: 15n }]);
  fakes.evm.balances.set(`ethereum:${user.evmAddress}:${shared.address}`, over.wallet ?? 10n);
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 50_000_000n);
  return { chain, user, shared, pA, pB };
}

/** The buy leg is sent and delivers `received` of the token to the user's EVM address. */
async function deliver(a: Awaited<ReturnType<typeof arrange>>, opId: string, received: bigint) {
  const [fee, buy] = await legsOf(opId);
  await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${opId}`;
  await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${fee!.id}`;
  await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-repair', submitted_at = now() WHERE id = ${buy!.id}`;
  a.chain.solanaFinality.set("sig-repair", "finalized");
  a.chain.lifiStatus.set("sig-repair", { state: "DONE", destinationTx: "0xdest" });
  fakes.evm.receipts.set("0xdest", { success: true, blockNumber: 100n, head: 120n, logs: [{ address: a.shared.address!, topics: [TRANSFER_TOPIC, pad("0x" + "22".repeat(20)), pad(a.user.evmAddress)], data: "0x" + received.toString(16) }] });
  await trackLeg(buy!.id);
}
const repairEntries = () => adminSql<{ position_id: string; quantity_delta: string }[]>`SELECT position_id, quantity_delta FROM app.position_ledger_entries WHERE reason = 'repair' ORDER BY quantity_delta`;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("repair (buy back)", () => {
  it("one operation for both baskets: the fee first, then one buy of the whole shortfall (Review Focus 4)", async () => {
    const { user, shared, pA, pB } = await arrange();
    const res = await repair(user.h, shared.deploymentId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "repair", status: "PLANNED", basketId: null, positionId: null });
    const [op] = await adminSql<{ repair_shares: Record<string, string>; deployment_id: string }[]>`SELECT repair_shares, deployment_id FROM app.operations WHERE id = ${res.body.id}`;
    expect(op).toEqual({ repair_shares: { [pA]: "6", [pB]: "9" }, deployment_id: shared.deploymentId });
    const legs = await legsOf(res.body.id);
    expect(legs.map((l) => l.kind)).toEqual(["network_fee", "cross_chain"]);
    expect(legs[1]!.amount_in).toBe("16"); // ceil(15 x $1 x 1.01) in micro-USDC
    const again = await repair(user.h, shared.deploymentId);
    expect(again.body.id).toBe(res.body.id);
  });

  it("a second request with a new key while the first is open is OPERATION_IN_PROGRESS", async () => {
    const { user, shared } = await arrange();
    await repair(user.h, shared.deploymentId);
    const second = await repair(user.h, shared.deploymentId, { idempotencyKey: "rep-bbbbbbbb" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("OPERATION_IN_PROGRESS");
  });

  it("needs free USDC for the fee and the buy; basket cash does not count", async () => {
    const { user, shared } = await arrange({ usdc: 10_000n });
    const res = await repair(user.h, shared.deploymentId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("a deployment that is not short is VALIDATION_FAILED", async () => {
    const { user, shared } = await arrange({ wallet: 25n });
    const res = await repair(user.h, shared.deploymentId);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("settlement: received 10 is split 4 and 6 by shortfall", async () => {
    const a = await arrange();
    const op = (await repair(a.user.h, a.shared.deploymentId)).body;
    await deliver(a, op.id, 10n);
    expect(await repairEntries()).toEqual([{ position_id: a.pA, quantity_delta: "4" }, { position_id: a.pB, quantity_delta: "6" }]);
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${op.id}`)[0]).toEqual({ status: "COMPLETED" });
  });

  it("settlement: received 20 covers both shortfalls and the excess stays outside the baskets", async () => {
    const a = await arrange();
    const op = (await repair(a.user.h, a.shared.deploymentId)).body;
    await deliver(a, op.id, 20n);
    expect(await repairEntries()).toEqual([{ position_id: a.pA, quantity_delta: "6" }, { position_id: a.pB, quantity_delta: "9" }]);
  });
});
