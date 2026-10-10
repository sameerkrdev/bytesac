import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, walletAddresses } from "@repo/db";
import type { AssetChain, Chain } from "@repo/validator";
import { app } from "@/app";
import { fakes } from "../../helpers/fakes";
import { signIn, webHeaders, type TestWallet } from "../../helpers/auth";
import { adminSql, resetDb, testDb } from "../../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

async function link(w: TestWallet, chain: Chain, chains: AssetChain[] | undefined, opts: { purpose?: "sign_in" | "add_chain_account"; cookie?: string; walletProvider?: string } = {}) {
  const headers = webHeaders(opts.cookie);
  const ch = await request(app).post("/v1/auth/challenge").set(headers).send({ purpose: opts.purpose ?? "sign_in", chain, address: w.address, ...(chains ? { chains } : {}) });
  if (ch.status !== 200) return ch;
  return request(app).post("/v1/auth/verify").set(headers).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web", walletProvider: opts.walletProvider });
}
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
const active = async () => (await db.select().from(walletAddresses)).filter((r) => r.status === "active").map((r) => `${r.chain}:${r.address.slice(0, 6)}`).sort();

describe("link exactly the ticked chains (D-120)", () => {
  it("sign-up links only the ticked chains and the message names them", async () => {
    const w = newEvmWallet();
    const ch = await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: "base", address: w.address, chains: ["base", "bnb"] });
    expect(ch.body.message).toContain("Base, BNB Chain");
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web", walletProvider: "MetaMask" });
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).map((r) => [r.chain, r.walletName])).toEqual(expect.arrayContaining([["base", "MetaMask"], ["bnb", "MetaMask"]]));
    expect(await active()).toHaveLength(2);
  });

  it("omitted chains keep today's behaviour (every EVM chain, Polygon included)", async () => {
    await link(newEvmWallet(), "base", undefined);
    expect((await active()).map((r) => r.split(":")[0])).toEqual(["arbitrum", "base", "bnb", "ethereum", "polygon"]);
  });

  it("a second wallet links other chains of the same family to the same account", async () => {
    const a = await link(newEvmWallet(), "base", ["base", "bnb"]);
    const res = await link(newEvmWallet(), "ethereum", ["ethereum", "arbitrum"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(200);
    expect(await active()).toHaveLength(4);
  });

  it("a chain already linked to a different address is CHAIN_ALREADY_LINKED", async () => {
    const a = await link(newEvmWallet(), "base", ["base"]);
    const res = await link(newEvmWallet(), "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_ALREADY_LINKED");
  });

  it("same address same chain is idempotent and does not rotate the session", async () => {
    const w = newEvmWallet();
    const a = await link(w, "base", ["base"]);
    const res = await link(w, "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await db.select().from(sessions)).filter((s) => s.revokeReason === "rotated")).toHaveLength(0);
  });

  it("sign-in from any linked chain reaches the same account", async () => {
    const first = newEvmWallet();
    const a = await link(first, "base", ["base"]);
    const second = newEvmWallet();
    await link(second, "ethereum", ["ethereum"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    const again = await link(second, "ethereum", ["ethereum"]);
    expect(again.body.userId).toBe(a.body.userId);
    expect(again.body.isNewUser).toBe(false);
  });

  it("chains outside the address family are a 400", async () => {
    const res = await link(newSolanaWallet(), "solana", ["solana", "base"]);
    expect(res.status).toBe(400);
  });

  it("sign-in with a known address can add ticked chains it lacks", async () => {
    const w = newEvmWallet();
    await link(w, "base", ["base"]);
    expect((await link(w, "base", ["base", "arbitrum"])).status).toBe(200);
    expect(await active()).toHaveLength(2);
  });

  it("a replaced address is refused (ADDRESS_DISABLED) and creates no session", async () => {
    const w = newEvmWallet();
    await link(w, "base", ["base", "ethereum"]);
    const [keep] = await db.select().from(walletAddresses);
    await adminSql`UPDATE app.wallet_addresses SET status = 'replaced', replaced_at = now(), replaced_by_address_id = ${keep!.id}, disabled_reason = 'chain_reassigned' WHERE chain = 'ethereum'`;
    const sessionsBefore = (await db.select().from(sessions)).length;
    const res = await link(w, "ethereum", ["ethereum"]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADDRESS_DISABLED");
    expect(res.body.error.message).toContain("moved to another wallet");
    expect((await db.select().from(sessions)).length).toBe(sessionsBefore);
    // same address, still active on base: sign-in on base is allowed
    expect((await link(w, "base", ["base"])).status).toBe(200);
    // add_chain_account with the replaced address is refused too
    const again = await link(w, "base", ["base"]);
    const add = await link(w, "ethereum", ["ethereum"], { purpose: "add_chain_account", cookie: cookieOf(again) });
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe("ADDRESS_DISABLED");
  });

  it("an address known on another chain signs into the same account, never a second one", async () => {
    const w = newEvmWallet();
    const first = await link(w, "base", ["base"]);
    const again = await link(w, "ethereum", ["ethereum"]);
    expect(again.status).toBe(200);
    expect(again.body.userId).toBe(first.body.userId);
    expect(again.body.isNewUser).toBe(false);
    expect(await active()).toHaveLength(2);
  });

  it("replaced on ethereum while another address holds ethereum -> ADDRESS_DISABLED (moved away), no session", async () => {
    const w = newEvmWallet();
    const a = await link(w, "base", ["base", "ethereum"]);
    const [baseRow] = (await db.select().from(walletAddresses)).filter((r) => r.chain === "base");
    await adminSql`UPDATE app.wallet_addresses SET status = 'replaced', replaced_at = now(), replaced_by_address_id = ${baseRow!.id}, disabled_reason = 'chain_reassigned' WHERE chain = 'ethereum'`;
    const b = await link(newEvmWallet(), "ethereum", ["ethereum"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(b.status).toBe(200);
    const before = (await db.select().from(sessions)).length;
    const res = await link(w, "ethereum", ["ethereum"]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADDRESS_DISABLED");
    expect((await db.select().from(sessions)).length).toBe(before);
  });

  it("a contract wallet signing on a chain where the address is not linked never reaches the account holding it elsewhere", async () => {
    fakes.evm.behavior = "valid";
    const sw = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    await signIn(app, sw, "base");
    const before = (await db.select().from(sessions)).length;
    const res = await link(sw, "ethereum", undefined);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
    expect((await db.select().from(sessions)).length).toBe(before);
    expect(await active()).toHaveLength(1);
  });

  it("a smart wallet links one chain at a time", async () => {
    fakes.evm.behavior = "valid";
    const sw = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    const bad = await link(sw, "base", ["base", "arbitrum"]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    expect(await db.select().from(walletAddresses)).toHaveLength(0);
    const ok = await signIn(app, sw, "base");
    expect(ok.res.status).toBe(200);
  });

  it("a chain whose wallet was disabled by support refuses a different address (no row)", async () => {
    const a = newEvmWallet();
    const first = await link(a, "base", ["base"]);
    await adminSql`UPDATE app.wallet_addresses SET status = 'disabled', disabled_at = now(), disabled_reason = 'support' WHERE chain = 'base'`;
    const res = await link(newEvmWallet(), "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(first) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_ALREADY_LINKED");
    expect(res.body.error.message).toContain("disabled by support");
    expect(await db.select().from(walletAddresses)).toHaveLength(1);
  });

  it("a replaced row on a chain does not block a new address there", async () => {
    const a = await link(newEvmWallet(), "ethereum", ["ethereum", "base"]);
    const [eth] = (await db.select().from(walletAddresses)).filter((r) => r.chain === "ethereum");
    const [base] = (await db.select().from(walletAddresses)).filter((r) => r.chain === "base");
    await adminSql`UPDATE app.wallet_addresses SET status = 'replaced', replaced_at = now(), replaced_by_address_id = ${eth!.id}, disabled_reason = 'chain_reassigned' WHERE id = ${base!.id}`;
    const res = await link(newEvmWallet(), "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(a) });
    expect(res.status).toBe(200);
    expect(await active()).toHaveLength(2);
  });

  it("legacy omitted chains skip a support-disabled chain without failing sign-in", async () => {
    const w = newEvmWallet();
    await link(w, "base", ["base"]);
    const first = await link(w, "base", ["base"]);
    expect((await link(newEvmWallet(), "ethereum", ["ethereum"], { purpose: "add_chain_account", cookie: cookieOf(first) })).status).toBe(200);
    await adminSql`UPDATE app.wallet_addresses SET status = 'disabled', disabled_at = now(), disabled_reason = 'support' WHERE chain = 'ethereum'`;
    const res = await link(w, "base", undefined);
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).filter((r) => r.chain === "ethereum" && r.address === w.address.toLowerCase())).toHaveLength(0);
  });

  it("an EOA already active in another account on any chain of the family is ADDRESS_ALREADY_LINKED on add_chain_account", async () => {
    const shared = newEvmWallet();
    await link(shared, "ethereum", ["ethereum"]);
    const mine = await link(newEvmWallet(), "base", ["base"]);
    const before = await db.select().from(walletAddresses);
    const res = await link(shared, "base", ["base"], { purpose: "add_chain_account", cookie: cookieOf(mine) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
    expect(await db.select().from(walletAddresses)).toHaveLength(before.length);
  });
});
