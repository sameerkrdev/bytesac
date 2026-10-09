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
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

const OLDW = newEvmWallet();
const OLD = OLDW.address.toLowerCase();
const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const BASE_NATIVE: SeedAsset = { symbol: "BASEX", chain: "base", tokenStandard: "native", bps: 5000 };
const BASE_TOKEN: SeedAsset = { symbol: "AERO", chain: "base", tokenStandard: "erc20", bps: 5000 };
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="));

async function challenge(headers: Record<string, string>, chain: string, address: string) {
  return request(app).post("/v1/auth/challenge").set(headers).send({ purpose: "reassign_chain", chain, address });
}
type Signer = { address: string; sign(m: string): Promise<string> | string };
/** `prev` signs as the chain's current address (default: the seeded old Base wallet); null sends no previousSignature. */
async function reassign(headers: Record<string, string>, chain: string, w: Signer = newEvmWallet(), prev: Signer | null = OLDW) {
  const ch = await challenge(headers, chain, w.address);
  return request(app).post("/v1/auth/reassign").set(headers).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), previousSignature: prev ? await prev.sign(ch.body.message) : undefined, client: "web" });
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
    const res = await reassign(user.h, "base", w, w);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("the address this user moved away from earlier cannot be picked again", async () => {
    const { user } = await arrange();
    const next = newEvmWallet();
    const first = await reassign(user.h, "base", next);
    expect(first.status).toBe(200);
    const back = await reassign(webHeaders(cookieOf(first)), "base", OLDW, next);
    expect(back.status).toBe(400);
    expect(back.body.error.code).toBe("VALIDATION_FAILED");
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
    const res = await reassign(webHeaders(s.cookie), "base", newEvmWallet(), w);
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

describe("step-up: the current address must sign too", () => {
  it("no previousSignature: SIGNATURE_INVALID and nothing changes", async () => {
    const { user } = await arrange();
    const res = await reassign(user.h, "base", newEvmWallet(), null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
    expect((await db.select().from(walletAddresses)).filter((r) => r.address === OLD && r.status === "active")).toHaveLength(2);
    expect((await request(app).get("/v1/me").set(user.h)).status).toBe(200); // session untouched
  });

  it("a previousSignature from the wrong key: SIGNATURE_INVALID", async () => {
    const { user } = await arrange();
    const res = await reassign(user.h, "base", newEvmWallet(), newEvmWallet());
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
    expect((await db.select().from(walletAddresses)).filter((r) => r.status === "replaced")).toHaveLength(0);
  });

  it("a challenge from another session is refused", async () => {
    const a = await arrange();
    const other = await signIn(app, newEvmWallet(), "base");
    const w = newEvmWallet();
    const ch = await challenge(a.user.h, "base", w.address);
    const res = await request(app).post("/v1/auth/reassign").set(webHeaders(other.cookie)).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), previousSignature: await OLDW.sign(ch.body.message), client: "web" });
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
  });
});

describe("other wallet kinds", () => {
  it("moves a Solana chain, signed by the new and the current Solana wallets", async () => {
    const oldSol = newSolanaWallet();
    const s = await signIn(app, oldSol, "solana");
    const h = webHeaders(s.cookie);
    const res = await reassign(h, "solana", newSolanaWallet(), oldSol);
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).map((r) => r.status).sort()).toEqual(["active", "replaced"]);
  });

  it("moves a chain held by an ERC-1271 wallet, verified on that chain", async () => {
    fakes.evm.behavior = "valid";
    const smart = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    const s = await signIn(app, smart, "base");
    const res = await reassign(webHeaders(s.cookie), "base", { address: "0x" + "cd".repeat(20), sign: () => "0x" + "22".repeat(100) }, smart);
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).find((r) => r.status === "active")!.verificationMethod).toBe("erc1271");
  });
});

describe("what counts as not empty", () => {
  it("native dust at the old address does not block; an ERC-20 balance does", async () => {
    const { basket, user } = await arrange([SOL, BASE_NATIVE, BASE_TOKEN]);
    fakes.evm.balances.set(`base:${OLD}`, 10n ** 17n);
    fakes.evm.balances.set(`base:${OLD}:${basket.deployments[2]!.address}`, 1n);
    expect((await reassign(user.h, "base")).body.error.code).toBe("CHAIN_NOT_EMPTY");
    fakes.evm.balances.delete(`base:${OLD}:${basket.deployments[2]!.address}`);
    expect((await reassign(user.h, "base")).status).toBe(200);
  });

  it("an unreadable balance fails closed (503) and keeps the challenge retryable", async () => {
    const { user } = await arrange([SOL, BASE_TOKEN]);
    fakes.evm.balances = new (class extends Map<string, bigint> { get(): never { throw Object.assign(new Error("rpc"), { status: 503, code: "VERIFIER_UNAVAILABLE", expose: true }); } })();
    const res = await reassign(user.h, "base");
    expect(res.status).toBe(503);
    expect((await db.select().from(walletAddresses)).filter((r) => r.status === "replaced")).toHaveLength(0);
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

describe("planning serializes with a move", () => {
  it("inserting a plan waits for a held lock on the user's investment wallet", async () => {
    const { basket, user } = await arrange();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const holder = adminSql.begin(async (tx) => {
      await tx`SELECT id FROM app.investment_wallets WHERE user_id = ${user.userId} FOR UPDATE`;
      locked();
      await held;
    });
    await lockTaken;
    let done = false;
    const pending = request(app).post("/v1/operations/invest").set(user.h).send({ basketId: basket.basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-bbbbbbbb" }).then((r) => { done = true; return r; });
    await new Promise((r) => setTimeout(r, 1500));
    expect(done).toBe(false);
    release();
    await holder;
    expect((await pending).status).toBe(201);
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
