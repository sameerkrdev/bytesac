import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { walletAddresses } from "@repo/db";
import { app } from "@/app";
import { assertChainEmpty } from "@/modules/auth/reassign.service";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { signIn, webHeaders } from "../../helpers/auth";
import { balanceKey, mockChains, solanaTestWallet } from "../../helpers/chain-mocks";
import { adminSql, resetDb, testDb } from "../../helpers/db";
import { USDC_MINT, seedBasket, seedLeg, seedPosition, seedUser, type SeedAsset } from "../../helpers/execution";
import { fakes } from "../../helpers/fakes";
import { newEvmWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

const OLD = "0x" + "aa".repeat(20);
const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const BASE_NATIVE: SeedAsset = { symbol: "BASEX", chain: "base", tokenStandard: "native", bps: 5000 };
const BASE_TOKEN: SeedAsset = { symbol: "AERO", chain: "base", tokenStandard: "erc20", bps: 5000 };
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="));

async function challenge(headers: Record<string, string>, chain: string, address: string) {
  return request(app).post("/v1/auth/challenge").set(headers).send({ purpose: "reassign_chain", chain, address });
}
async function reassign(headers: Record<string, string>, chain: string, w = newEvmWallet()) {
  const ch = await challenge(headers, chain, w.address);
  return request(app).post("/v1/auth/reassign").set(headers).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
}
/** A Solana-signed-in user whose Base and Ethereum addresses are both OLD. */
async function arrange(assets: SeedAsset[] = [SOL, BASE_NATIVE]) {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets });
  const user = await seedUser({ wallet: solanaTestWallet(), evmByChain: { base: OLD, ethereum: OLD } });
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
  return { chain, basket, user };
}

describe("reassign a chain (only when empty)", () => {
  it("moves an empty chain, keeps history and rotates the session", async () => {
    const { user } = await arrange();
    const res = await reassign(user.h, "base");
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toBeDefined();
    expect((await request(app).get("/v1/me").set(user.h)).status).toBe(401); // old session rotated away
    const [wallet] = await adminSql<{ id: string }[]>`SELECT id FROM app.investment_wallets WHERE user_id = ${user.userId}`;
    const all = (await db.select().from(walletAddresses)).filter((r) => r.investmentWalletId === wallet!.id);
    const rows = all.filter((r) => r.chain === "base");
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "replaced"]);
    const old = rows.find((r) => r.status === "replaced")!;
    expect(old.replacedByAddressId).toBe(rows.find((r) => r.status === "active")!.id);
    expect(old.disabledReason).toBe("chain_reassigned");
    expect(all.find((r) => r.chain === "ethereum")!.status).toBe("active"); // other chains untouched
  });

  it("refuses when the old address still holds a registered asset on the chain", async () => {
    const { basket, user } = await arrange([SOL, BASE_TOKEN]);
    fakes.evm.balances.set(`base:${OLD}:${basket.deployments[1]!.address}`, 5n);
    const res = await reassign(user.h, "base");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_NOT_EMPTY");
  });

  it("refuses when the ledger still holds units on the chain even if the wallet reads empty", async () => {
    const { basket, user } = await arrange([SOL, BASE_NATIVE]);
    await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[1]!.deploymentId, quantity: 3n }]);
    const res = await reassign(user.h, "base");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_NOT_EMPTY");
  });

  it("refuses a chain that is not linked yet", async () => {
    const { user } = await arrange();
    const res = await reassign(user.h, "arbitrum");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_NOT_LINKED");
  });

  it("refuses the address the chain already uses", async () => {
    const { user } = await arrange();
    const w = newEvmWallet();
    await adminSql`UPDATE app.wallet_addresses SET address = ${w.address.toLowerCase()} WHERE chain = 'base' AND address = ${OLD}`;
    const res = await reassign(user.h, "base", w);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("an address linked to another user on that chain is 409 ADDRESS_ALREADY_LINKED", async () => {
    const { user } = await arrange();
    const other = newEvmWallet();
    await signIn(app, other, "base");
    const res = await reassign(user.h, "base", other);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
  });

  it("a challenge for reassign needs a session, and Bitcoin is not reassignable", async () => {
    const { user } = await arrange();
    const anon = await challenge(webHeaders(), "base", newEvmWallet().address);
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("SESSION_EXPIRED");
    const btc = await challenge(user.h, "bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(btc.status).toBeGreaterThanOrEqual(400);
  });

  it("the old address can no longer sign in on the moved chain", async () => {
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const res = await reassign(webHeaders(s.cookie), "base");
    expect(res.status).toBe(200);
    const again = await signIn(app, w, "base");
    expect(again.res.status).toBe(403);
    expect(again.res.body.error.code).toBe("ADDRESS_DISABLED");
  });

  it("plan after reassign uses the new address", async () => {
    const { chain, basket, user } = await arrange();
    const w = newEvmWallet();
    const res = await reassign(user.h, "base", w);
    expect(res.status).toBe(200);
    const h = webHeaders(cookieOf(res));
    const inv = await request(app).post("/v1/operations/invest").set(h).send({ basketId: basket.basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa" });
    expect(inv.status).toBe(201);
    expect(chain.quotes.find((q) => q.toChain === "base")?.toAddress).toBe(w.address.toLowerCase());
  });
});

describe("an open operation blocks the move", () => {
  it("refused while an operation is open", async () => {
    const { basket, user } = await arrange();
    await seedLeg(user.userId, basket);
    const res = await reassign(user.h, "base");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OPERATION_IN_PROGRESS");
  });

  it("an IN_PROGRESS operation blocks", async () => {
    const { basket, user } = await arrange();
    const { operationId } = await seedLeg(user.userId, basket);
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${operationId}`;
    expect((await reassign(user.h, "base")).body.error.code).toBe("OPERATION_IN_PROGRESS");
  });

  it("an expired PLANNED operation does not block", async () => {
    const { basket, user } = await arrange();
    const { operationId } = await seedLeg(user.userId, basket);
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 minute' WHERE id = ${operationId}`;
    expect((await reassign(user.h, "base")).status).toBe(200);
  });
});

describe("assertChainEmpty", () => {
  it("open operation first, then ledger units, then on-chain balances", () => {
    expect(() => assertChainEmpty({ openOperation: true, heldUnits: [], onchain: [] })).toThrow(expect.objectContaining({ code: "OPERATION_IN_PROGRESS" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [{ symbol: "AERO" }], onchain: [] })).toThrow(expect.objectContaining({ code: "CHAIN_NOT_EMPTY" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [], onchain: [{ symbol: "AERO", amount: 1n }] })).toThrow(expect.objectContaining({ code: "CHAIN_NOT_EMPTY" }));
    expect(() => assertChainEmpty({ openOperation: false, heldUnits: [], onchain: [{ symbol: "AERO", amount: 0n }] })).not.toThrow();
  });
});
