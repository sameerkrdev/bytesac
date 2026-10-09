import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, sessions, users, walletAddresses } from "@repo/db";
import { app } from "@/app";
import { fakes } from "../../helpers/fakes";
import { challengeFor, signIn, webHeaders } from "../../helpers/auth";
import { adminSql, resetDb, testDb } from "../../helpers/db";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

describe("sign-in", () => {
  it("EOA sign-up registers 5 EVM chains, sets httpOnly cookie, audits", async () => {
    const w = newEvmWallet();
    const r = await signIn(app, w, "base");
    expect(r.res.status).toBe(200);
    expect(r.res.body.isNewUser).toBe(true);
    expect(r.res.body.token).toBeUndefined();
    expect(String(r.res.headers["set-cookie"])).toMatch(/bx_session=.*HttpOnly.*SameSite=Lax/i);
    const rows = await db.select().from(walletAddresses);
    expect(rows.map((x) => x.chain).sort()).toEqual(["arbitrum", "base", "bnb", "ethereum", "polygon"]);
    expect(rows.every((x) => x.verificationMethod === "eoa_ecdsa" && x.verifiedOnChain === "base" && x.address === w.address.toLowerCase())).toBe(true);
    const actions = (await db.select().from(auditEvents)).map((a) => a.action).sort();
    expect(actions).toEqual(["session.created", "user.signed_in", "user.signed_up"]);
  });

  it("Solana mobile sign-up returns token in body, registers solana only", async () => {
    const r = await signIn(app, newSolanaWallet(), "solana", "mobile");
    expect(r.res.status).toBe(200);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.res.headers["set-cookie"]).toBeUndefined();
    expect((await db.select().from(walletAddresses)).map((x) => x.chain)).toEqual(["solana"]);
  });

  it("repeat sign-in (checksummed vs lowercase) logs into the same user", async () => {
    const w = newEvmWallet();
    const first = await signIn(app, { address: w.address.toLowerCase(), sign: w.sign }, "ethereum");
    const second = await signIn(app, w, "arbitrum");
    expect(second.res.body).toMatchObject({ userId: first.userId, isNewUser: false });
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("smart wallet (ERC-1271) registers only the verified chain", async () => {
    fakes.evm.behavior = "valid";
    const address = "0x" + "ab".repeat(20);
    const r = await signIn(app, { address, sign: () => "0x" + "11".repeat(100) }, "base");
    expect(r.res.status).toBe(200);
    const rows = await db.select().from(walletAddresses);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chain: "base", verificationMethod: "erc1271" });
  });

  it("undeployed smart wallet (ERC-6492) registers only the verified chain", async () => {
    fakes.evm.behavior = "valid";
    const r = await signIn(app, { address: "0x" + "cd".repeat(20), sign: () => "0x" + "22".repeat(96) + ERC6492_SUFFIX }, "arbitrum");
    expect(r.res.status).toBe(200);
    expect((await db.select().from(walletAddresses))[0]).toMatchObject({ chain: "arbitrum", verificationMethod: "erc6492" });
  });

  it("invalid signature → 401 SIGNATURE_INVALID, challenge rejected, not retryable", async () => {
    const w = newEvmWallet();
    const other = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const bad = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await other.sign(ch.body.message), client: "web" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("SIGNATURE_INVALID");
    const retry = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
    expect(retry.body.error.code).toBe("CHALLENGE_CONSUMED");
    const [row] = await db.select().from(authChallenges);
    expect(row!.status).toBe("rejected");
  });

  it("malformed signature encodings are SIGNATURE_INVALID, never 500", async () => {
    for (const [chain, wallet, sig] of [
      ["base", newEvmWallet(), "deadbeef"],
      ["solana", newSolanaWallet(), "c2lnbmF0dXJl+/=="],
    ] as const) {
      const ch = await challengeFor(app, { purpose: "sign_in", chain, address: wallet.address });
      const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: sig, client: "web" });
      expect(res.status).toBe(401);
    }
  });

  it("verifier outage → 503 and the same signature succeeds on retry", async () => {
    fakes.evm.behavior = "unavailable";
    const address = "0x" + "ab".repeat(20);
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address });
    const body = { challengeId: ch.body.challengeId, signature: "0x" + "11".repeat(100), client: "web" };
    const first = await request(app).post("/v1/auth/verify").set(webHeaders()).send(body);
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe("VERIFIER_UNAVAILABLE");
    fakes.evm.behavior = "valid";
    expect((await request(app).post("/v1/auth/verify").set(webHeaders()).send(body)).status).toBe(200);
  });

  it("no DB transaction is open while the RPC call runs", async () => {
    let idleInTx = -1;
    fakes.evm.behavior = "valid";
    fakes.evm.onCall = async () => {
      const rows = await adminSql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'bytesac_api' AND state LIKE 'idle in transaction%'`;
      idleInTx = rows[0]!.n;
    };
    await signIn(app, { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) }, "base");
    expect(idleInTx).toBe(0);
  });

  it("double submit of one challenge → exactly one session", async () => {
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const body = { challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" };
    const results = await Promise.all([1, 2, 3].map(() => request(app).post("/v1/auth/verify").set(webHeaders()).send(body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(["CHALLENGE_IN_PROGRESS", "CHALLENGE_CONSUMED"]).toContain(r.body.error.code);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("concurrent sign-up of one new address with two challenges → one user, both logged in", async () => {
    const w = newEvmWallet();
    const [a, b] = await Promise.all([signIn(app, w, "base"), signIn(app, w, "ethereum")]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(a.userId).toBe(b.userId);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("expired challenge → 410 CHALLENGE_EXPIRED; unknown → 404", async () => {
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '1 second'`;
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "web" });
    expect(res.status).toBe(410);
    const nf = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", signature: "0x00", client: "web" });
    expect(nf.status).toBe(404);
  });

  it("message signed for a different domain fails", async () => {
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const forged = String(ch.body.message).replace("localhost:3000", "evil.test");
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.body.challengeId, signature: await w.sign(forged), client: "web" });
    expect(res.status).toBe(401);
  });

  it("disabled address → 403 ADDRESS_DISABLED; suspended user → 401 USER_NOT_ACTIVE", async () => {
    const w = newEvmWallet();
    const first = await signIn(app, w, "base");
    await adminSql`UPDATE app.wallet_addresses SET status = 'disabled', disabled_reason = 'test'`;
    expect((await signIn(app, w, "base")).res.body.error.code).toBe("ADDRESS_DISABLED");
    await adminSql`UPDATE app.wallet_addresses SET status = 'active', disabled_reason = null`;
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${first.userId}`;
    expect((await signIn(app, w, "base")).res.body.error.code).toBe("USER_NOT_ACTIVE");
  });

  it("challenge uses server time only and stores the exact message", async () => {
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, ch.body.challengeId));
    expect(row!.message).toBe(ch.body.message);
    expect(row!.expiresAt.getTime() - row!.issuedAt.getTime()).toBe(300_000);
  });

  it("invalid address or unsupported chain → 400", async () => {
    expect((await challengeFor(app, { purpose: "sign_in", chain: "base", address: "0x123" })).status).toBe(400);
    expect((await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: "dogecoin", address: "0x" + "1".repeat(40) })).status).toBe(400);
  });

  it("challenge and verify are rate limited", async () => {
    for (let i = 0; i < 20; i++) expect((await challengeFor(app, { purpose: "sign_in", chain: "base", address: newEvmWallet().address })).status).toBe(200);
    const res = await challengeFor(app, { purpose: "sign_in", chain: "base", address: newEvmWallet().address });
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("add_chain_account race", () => {
  it("two sessions adding different Solana wallets concurrently → one 200, one 409", async () => {
    const evm = newEvmWallet();
    const web = await signIn(app, evm, "base");
    const mobile = await signIn(app, evm, "base", "mobile");
    const hw = webHeaders(web.cookie);
    const hm = { "X-Client": "mobile", Authorization: `Bearer ${mobile.token}` };
    const run = async (headers: Record<string, string>, client: "web" | "mobile") => {
      const sol = newSolanaWallet();
      const ch = await challengeFor(app, { purpose: "add_chain_account", chain: "solana", address: sol.address }, headers);
      expect(ch.status).toBe(200);
      return request(app).post("/v1/auth/verify").set(headers).send({ challengeId: ch.body.challengeId, signature: await sol.sign(ch.body.message), client });
    };
    const [a, b] = await Promise.all([run(hw, "web"), run(hm, "mobile")]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe("CHAIN_FAMILY_ALREADY_LINKED");
    expect((await db.select().from(walletAddresses)).filter((r) => r.chain === "solana")).toHaveLength(1);
  });
});
