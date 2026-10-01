import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { verifyBitcoinProof } from "../../src/providers/bitcoin";
import { webHeaders } from "../helpers/auth";
import { adminSql, resetDb } from "../helpers/db";
import { INVALID, VALID } from "./bip322-vectors";
import { bip137Signature, bip322Psbt, bitcoinWallet, seedUser, type BtcKind } from "./helpers";

describe("BIP-322 verification", () => {
  it.each(VALID.flatMap((v) => v.signatures.map((s) => [v.type, JSON.stringify(v.message).slice(0, 30), v.address, v.message, s] as const)))(
    "accepts the official %s vector for %s", (_type, _label, address, message, signature) => {
      expect(verifyBitcoinProof({ address, message, signature, method: "bip322" })).toBe(true);
    },
  );

  it.each(INVALID.map((v) => [v.description, v] as const))("rejects the official error vector: %s", (_d, v) => {
    expect(verifyBitcoinProof({ address: v.address, message: v.message, signature: v.signature, method: "bip322" })).toBe(false);
  });

  it.each<BtcKind>(["p2wpkh", "p2tr", "p2sh-p2wpkh"])("accepts a wallet-signed to_sign PSBT for %s, and nothing else", (kind) => {
    const w = bitcoinWallet(kind);
    const signature = bip322Psbt(w, "link me");
    expect(verifyBitcoinProof({ address: w.address, message: "link me", signature, method: "bip322" })).toBe(true);
    expect(verifyBitcoinProof({ address: w.address, message: "another message", signature, method: "bip322" })).toBe(false);
    expect(verifyBitcoinProof({ address: bitcoinWallet(kind).address, message: "link me", signature, method: "bip322" })).toBe(false);
    expect(verifyBitcoinProof({ address: w.address, message: "link me", signature: "not a signature", method: "bip322" })).toBe(false);
  });

  it.each<BtcKind>(["p2wpkh", "p2sh-p2wpkh"])("accepts a BIP-137 signature for %s and rejects a changed message or address", (kind) => {
    const w = bitcoinWallet(kind);
    const signature = bip137Signature(w, "link me");
    expect(verifyBitcoinProof({ address: w.address, message: "link me", signature, method: "bip137" })).toBe(true);
    expect(verifyBitcoinProof({ address: w.address, message: "link you", signature, method: "bip137" })).toBe(false);
    expect(verifyBitcoinProof({ address: bitcoinWallet(kind).address, message: "link me", signature, method: "bip137" })).toBe(false);
  });
});

const challenge = (h: Record<string, string>, address: string) => request(app).post("/v1/me/chain-accounts/bitcoin/challenge").set(h).send({ address });
const verify = (h: Record<string, string>, body: object) => request(app).post("/v1/me/chain-accounts/bitcoin/verify").set(h).send(body);

/** Challenge, wallet-sign (BIP-322 PSBT or BIP-137) and verify; returns the verify response and the rotated session headers. */
async function link(h: Record<string, string>, w: ReturnType<typeof bitcoinWallet>, method: "bip322" | "bip137" = "bip322") {
  const ch = await challenge(h, w.address);
  expect(ch.status).toBe(200);
  const signature = method === "bip322" ? bip322Psbt(w, ch.body.message) : bip137Signature(w, ch.body.message);
  const res = await verify(h, { challengeId: ch.body.challengeId, address: w.address, signature, method });
  const cookie = (res.headers["set-cookie"] as unknown as string[] | undefined)?.map((c) => c.split(";")[0]).find((c) => c?.startsWith("bx_session="));
  return Object.assign(res, { next: cookie ? webHeaders(cookie) : h });
}

describe("linking a Bitcoin address", () => {
  beforeEach(resetDb);

  it("links a BIP-322 address, rotates the session and shows it on /me with its method; the challenge says link, not sign in", async () => {
    const u = await seedUser({ evm: false });
    const w = bitcoinWallet("p2wpkh");
    const ch = await challenge(u.h, w.address);
    expect(ch.body.message).toContain("link your Bitcoin account");
    expect(ch.body.message).toContain(w.address);
    expect(Buffer.from(ch.body.toSignPsbt, "base64").subarray(0, 5).toString("hex")).toBe("70736274ff");
    const res = await verify(u.h, { challengeId: ch.body.challengeId, address: w.address, signature: bip322Psbt(w, ch.body.message), method: "bip322" });
    expect(res.status).toBe(200);
    const cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).find((c) => c?.startsWith("bx_session="));
    expect(cookie).toBeTruthy();
    const me = await request(app).get("/v1/me").set(webHeaders(cookie));
    expect(me.body.wallet.addresses).toContainEqual(expect.objectContaining({ chain: "bitcoin", chainFamily: "bitcoin", address: w.address, verificationMethod: "bip322", status: "active" }));
    const audit = await adminSql`SELECT action FROM app.audit_events WHERE action = 'wallet.chain_account_added' AND actor_user_id = ${u.userId}`;
    expect(audit).toHaveLength(1);
  });

  it("links with BIP-137 and taproot addresses", async () => {
    const a = await seedUser({ evm: false });
    expect((await link(a.h, bitcoinWallet("p2wpkh"), "bip137")).status).toBe(200);
    const b = await seedUser({ evm: false });
    expect((await link(b.h, bitcoinWallet("p2tr"))).status).toBe(200);
    const rows = await adminSql<{ verification_method: string }[]>`SELECT verification_method FROM app.wallet_addresses WHERE chain = 'bitcoin' ORDER BY verification_method`;
    expect(rows.map((r) => r.verification_method).sort()).toEqual(["bip137", "bip322"]);
  });

  it("refuses an address already linked to another user (409) and a second address for the same user (409)", async () => {
    const w = bitcoinWallet();
    const first = await seedUser({ evm: false });
    expect((await link(first.h, w)).status).toBe(200);
    const other = await seedUser({ evm: false });
    const taken = await link(other.h, w);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("ADDRESS_ALREADY_LINKED");
    const again = await seedUser({ evm: false });
    const linked = await link(again.h, bitcoinWallet());
    expect(linked.status).toBe(200);
    const second = await link(linked.next, bitcoinWallet());
    expect(second.body.error.code).toBe("CHAIN_FAMILY_ALREADY_LINKED");
  });

  it("rejects a bad signature, a signature for another message, and an address that differs from the challenge", async () => {
    const u = await seedUser({ evm: false });
    const w = bitcoinWallet();
    const ch = await challenge(u.h, w.address);
    const bad = await verify(u.h, { challengeId: ch.body.challengeId, address: w.address, signature: bip322Psbt(w, "something else"), method: "bip322" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("SIGNATURE_INVALID");
    const ch2 = await challenge(u.h, w.address);
    const wrongAddress = await verify(u.h, { challengeId: ch2.body.challengeId, address: bitcoinWallet().address, signature: bip322Psbt(w, ch2.body.message), method: "bip322" });
    expect(wrongAddress.body.error.code).toBe("SIGNATURE_INVALID");
    expect(await adminSql`SELECT 1 FROM app.wallet_addresses WHERE chain = 'bitcoin'`).toHaveLength(0);
  });

  it("needs a session and a valid address, and Bitcoin is never a sign-in chain", async () => {
    const w = bitcoinWallet();
    expect((await request(app).post("/v1/me/chain-accounts/bitcoin/challenge").set(webHeaders()).send({ address: w.address })).status).toBe(401);
    const u = await seedUser();
    expect((await challenge(u.h, "not-an-address")).status).toBe(400);
    const signIn = await request(app).post("/v1/auth/challenge").set(webHeaders()).send({ purpose: "sign_in", chain: "bitcoin", address: w.address });
    expect(signIn.status).toBe(400);
  });

  it("allows 10 link attempts per hour per user", async () => {
    const u = await seedUser();
    const attempt = () => verify(u.h, { challengeId: crypto.randomUUID(), address: bitcoinWallet().address, signature: "x", method: "bip322" });
    for (let n = 0; n < 10; n++) expect((await attempt()).status).toBe(404);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});
