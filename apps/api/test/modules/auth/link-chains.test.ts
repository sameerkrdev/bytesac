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
});
