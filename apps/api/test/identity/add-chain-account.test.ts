import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { sessions, walletAddresses } from "@repo/db";
import { app } from "../../src/app";
import { fakes } from "../helpers/fakes";
import { challengeFor, signIn, webHeaders } from "../helpers/auth";
import { adminSql, resetDb, testDb } from "../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

async function addChain(app: Parameters<typeof challengeFor>[0], cookie: string, wallet: { address: string; sign(m: string): Promise<string> | string }, chain: "solana" | "base" | "ethereum" | "arbitrum" | "bnb") {
  const ch = await challengeFor(app, { purpose: "add_chain_account", chain, address: wallet.address }, webHeaders(cookie));
  if (ch.status !== 200) return ch;
  return request(app).post("/v1/auth/verify").set(webHeaders(cookie)).send({ challengeId: ch.body.challengeId, signature: await wallet.sign(ch.body.message), client: "web" });
}

describe("add chain account", () => {
  it("adds Solana to an EVM user, rotates the session, old token rejected", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, newSolanaWallet(), "solana");
    expect(res.status).toBe(200);
    const newCookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c!.startsWith("bx_session="))!;
    expect(newCookie).not.toBe(s.cookie);
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(401);
    expect((await request(app).get("/v1/me").set("Cookie", newCookie)).status).toBe(200);
    const rotated = (await db.select().from(sessions)).find((x) => x.revokeReason === "rotated");
    expect(rotated?.replacedBySessionId).toBeTruthy();
    expect((await db.select().from(walletAddresses)).map((a) => a.chain).sort()).toEqual(["arbitrum", "base", "bnb", "ethereum", "solana"]);
  });

  it("same address already on this user → idempotent, no rotation", async () => {
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const res = await addChain(app, s.cookie!, w, "arbitrum");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(200);
  });

  it("address owned by another user → 409 ADDRESS_ALREADY_LINKED", async () => {
    const sol = newSolanaWallet();
    await signIn(app, sol, "solana");
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, sol, "solana");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
  });

  it("two users racing to link the same new address → exactly one wins", async () => {
    const sol = newSolanaWallet();
    const a = await signIn(app, newEvmWallet(), "base");
    const b = await signIn(app, newEvmWallet(), "base");
    const [ra, rb] = await Promise.all([addChain(app, a.cookie!, sol, "solana"), addChain(app, b.cookie!, sol, "solana")]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect((await db.select().from(walletAddresses)).filter((x) => x.chain === "solana")).toHaveLength(1);
  });

  it("different address in an already-linked family → 409 CHAIN_FAMILY_ALREADY_LINKED", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await addChain(app, s.cookie!, newEvmWallet(), "base");
    expect(res.body.error.code).toBe("CHAIN_FAMILY_ALREADY_LINKED");
  });

  it("smart wallet can add the same address on another EVM chain", async () => {
    fakes.evm.behavior = "valid";
    const sw = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    const s = await signIn(app, sw, "base");
    const res = await addChain(app, s.cookie!, sw, "arbitrum");
    expect(res.status).toBe(200);
    expect((await db.select().from(walletAddresses)).map((a) => a.chain).sort()).toEqual(["arbitrum", "base"]);
  });

  it("add_chain_account challenge without a session → 401; used from another session → rejected", async () => {
    expect((await challengeFor(app, { purpose: "add_chain_account", chain: "solana", address: newSolanaWallet().address })).status).toBe(401);
    const a = await signIn(app, newEvmWallet(), "base");
    const b = await signIn(app, newEvmWallet(), "base");
    const sol = newSolanaWallet();
    const ch = await challengeFor(app, { purpose: "add_chain_account", chain: "solana", address: sol.address }, webHeaders(a.cookie));
    const res = await request(app).post("/v1/auth/verify").set(webHeaders(b.cookie)).send({ challengeId: ch.body.challengeId, signature: sol.sign(ch.body.message), client: "web" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
  });
  it("a session revoked while the signature is being verified is not rotated and nothing is linked", async () => {
    fakes.evm.behavior = "valid";
    const sw = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };
    const s = await signIn(app, sw, "base");
    fakes.evm.onCall = async () => { await adminSql`UPDATE app.sessions SET revoked_at = now(), revoke_reason = 'logout'`; };
    const res = await addChain(app, s.cookie!, sw, "arbitrum");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect((await db.select().from(walletAddresses)).map((a) => a.chain)).toEqual(["base"]);
  });
});
