import request from "supertest";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, organizationPayoutWallets, sessions, users, walletAddresses } from "@repo/db";
import { app } from "@/app";
import { decidePayoutWallet } from "@/services/organization-review";
import { enterPayoutWallet } from "@/services/payout-wallets";
import { challengeFor, signIn, webHeaders } from "../helpers/auth";
import { adminSql, testDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { newSolanaWallet } from "../helpers/wallets";
import { createOrg, ops, proveWallet, readyOrg, resetOrgDb, user } from "./helpers";

const db = testDb.db;
beforeEach(resetOrgDb);

const wallets = (orgId: string) => db.select().from(organizationPayoutWallets).where(eq(organizationPayoutWallets.organizationId, orgId)).orderBy(organizationPayoutWallets.createdAt, organizationPayoutWallets.id);
const enter = (h: Record<string, string>, id: string, address: string) => request(app).post(`/v1/organizations/${id}/payout-wallet`).set(h).send({ address });
const challenge = (h: Record<string, string>, id: string) => request(app).post(`/v1/organizations/${id}/payout-wallet/challenge`).set(h);
const verify = (h: Record<string, string>, id: string, body: object) => request(app).post(`/v1/organizations/${id}/payout-wallet/verify`).set(h).send(body);
const counts = async () => ({
  users: (await db.select({ n: count() }).from(users))[0]!.n,
  sessions: (await db.select({ n: count() }).from(sessions))[0]!.n,
  addresses: (await db.select({ n: count() }).from(walletAddresses))[0]!.n,
});

describe("payout wallet proof", () => {
  it("a typed address alone is never VERIFIED", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const w = newSolanaWallet();
    const res = await enter(u.h, id, w.address);
    expect(res.status).toBe(201);
    expect(res.body.payoutWallets).toEqual([expect.objectContaining({ address: w.address, status: "UNVERIFIED", verifiedAt: null })]);
    expect(res.body.missing.payoutWallet).toBe(true);
    expect((await enter(u.h, id, "not-a-solana-address")).status).toBe(400);
  });

  it("enter -> challenge -> signature -> VERIFIED, bound to the organization, without touching sessions or wallet addresses", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const before = await counts();
    const { res, wallet, challenge: ch } = await proveWallet(app, u.h, id);
    expect(res.status).toBe(200);
    expect(res.body.payoutWallets).toEqual([expect.objectContaining({ address: wallet.address, status: "VERIFIED" })]);
    expect(res.body.missing.payoutWallet).toBe(false);
    expect(ch.message).toContain(`Verify payout wallet for Bytesac organization ${id}. This does not sign you in or authorize any transfer.`);
    expect(ch.message.startsWith("Bytesac payout wallet verification\n\n")).toBe(true);
    expect(ch.message).not.toContain("wants you to sign in");
    expect(ch.message).toMatch(new RegExp(`\nOrganization: ${id}\nWallet: ${wallet.address}\nNonce: [0-9a-f]{32}\nIssued At: .+\nExpiration Time: .+$`));
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, ch.challengeId));
    expect(row).toMatchObject({ purpose: "payout_wallet", organizationId: id, chain: "solana", address: wallet.address, status: "consumed" });
    expect(await counts()).toEqual(before);
    const [w] = await wallets(id);
    expect(w!.activatedAt).toBeTruthy();
    expect(w!.verificationChallengeId).toBe(ch.challengeId);
    expect(w!.verificationSignature).toBeTruthy();
    // the proof survives retention long after the challenge expired
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '8 days', issued_at = now() - interval '9 days'`;
    await adminSql`SELECT app.purge_expired()`;
    expect(await db.select({ id: authChallenges.id }).from(authChallenges).where(eq(authChallenges.id, ch.challengeId))).toHaveLength(1);
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "payout_wallet.verified")))).toHaveLength(1);
    // the same signature cannot be replayed
    expect((await verify(u.h, id, { challengeId: ch.challengeId, signature: await wallet.sign(ch.message) })).body.error.code).toBe("CHALLENGE_CONSUMED");
  });

  it("challenge needs an entered address and an owner", async () => {
    const u = await user(app);
    const other = await user(app);
    const id = await createOrg(app, u.h);
    expect((await challenge(u.h, id)).body.error.code).toBe("INVALID_TRANSITION");
    await enter(u.h, id, newSolanaWallet().address);
    expect((await challenge(other.h, id)).status).toBe(403);
    expect((await enter(other.h, id, newSolanaWallet().address)).status).toBe(403);
  });

  it("a payout challenge is refused by /v1/auth/verify and no user or session is created", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const w = newSolanaWallet();
    await enter(u.h, id, w.address);
    const ch = (await challenge(u.h, id)).body;
    const before = await counts();
    const res = await request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId: ch.challengeId, signature: await w.sign(ch.message), client: "web" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CHALLENGE_NOT_FOUND");
    expect(await counts()).toEqual(before);
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, ch.challengeId)))[0]!.status).toBe("pending");
    // and it still works on the payout route
    expect((await verify(u.h, id, { challengeId: ch.challengeId, signature: await w.sign(ch.message) })).status).toBe(200);
  });

  it("a sign-in challenge is refused by the payout verify route and stays usable for sign-in", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const w = newSolanaWallet();
    await enter(u.h, id, w.address);
    const signInChallenge = (await challengeFor(app, { purpose: "sign_in", chain: "solana", address: w.address })).body;
    const res = await verify(u.h, id, { challengeId: signInChallenge.challengeId, signature: await w.sign(signInChallenge.message) });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CHALLENGE_NOT_FOUND");
    expect((await wallets(id))[0]!.status).toBe("UNVERIFIED");
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, signInChallenge.challengeId)))[0]!.status).toBe("pending");
  });

  it("a challenge issued in another session is rejected", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const w = newSolanaWallet();
    await enter(u.h, id, w.address);
    const ch = (await challenge(u.h, id)).body;
    const second = webHeaders((await signIn(app, u.wallet, "base")).cookie);
    const res = await verify(second, id, { challengeId: ch.challengeId, signature: await w.sign(ch.message) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
    expect((await wallets(id))[0]!.status).toBe("VERIFYING");
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, ch.challengeId)))[0]!.status).toBe("rejected");
  });

  it("a signature from a different key is rejected and the wallet stays unverified", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    await enter(u.h, id, newSolanaWallet().address);
    const ch = (await challenge(u.h, id)).body;
    const res = await verify(u.h, id, { challengeId: ch.challengeId, signature: await newSolanaWallet().sign(ch.message) });
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
    expect((await wallets(id))[0]!.status).toBe("VERIFYING");
  });

  it("before verification, proving a new wallet replaces the old one, which is revoked", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const first = await proveWallet(app, u.h, id);
    const second = await proveWallet(app, u.h, id);
    expect(second.res.status).toBe(200);
    const rows = await wallets(id);
    expect(rows.map((r) => [r.address, r.status])).toEqual([[first.wallet.address, "REVOKED"], [second.wallet.address, "VERIFIED"]]);
    expect(rows[0]!.deactivatedAt).toBeTruthy();
    // an abandoned entry is revoked when a new address is typed
    await enter(u.h, id, newSolanaWallet().address);
    await enter(u.h, id, newSolanaWallet().address);
    expect((await wallets(id)).map((r) => r.status)).toEqual(["REVOKED", "VERIFIED", "REVOKED", "UNVERIFIED"]);
  });

  it("the wallet cannot change while the organization is in review", async () => {
    const o = await readyOrg(app);
    await request(app).post(`/v1/organizations/${o.id}/submit`).set(o.h);
    expect((await enter(o.h, o.id, newSolanaWallet().address)).body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("payout wallet replacement on a verified organization", () => {
  async function verified() {
    const o = await readyOrg(app);
    await adminSql`UPDATE app.organizations SET status = 'VERIFIED', verified_at = now() WHERE id = ${o.id}`;
    return o;
  }

  it("re-proving becomes REPLACEMENT_PENDING while the old wallet stays VERIFIED, and a second change is blocked", async () => {
    const o = await verified();
    const next = await proveWallet(app, o.h, o.id);
    expect(next.res.status).toBe(200);
    expect((await wallets(o.id)).map((r) => [r.address, r.status])).toEqual([[o.payoutWallet.address, "VERIFIED"], [next.wallet.address, "REPLACEMENT_PENDING"]]);
    expect(fakes.email.organization).toEqual([expect.objectContaining({ kind: "payout_replacement_requested" })]);
    const blocked = await enter(o.h, o.id, newSolanaWallet().address);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toBe("A payout wallet change is already awaiting review.");
  });

  it("ops approval swaps the wallets; rejection leaves the old one active", async () => {
    const reviewer = await ops(app);
    const o = await verified();
    const next = await proveWallet(app, o.h, o.id);
    const pending = (await wallets(o.id))[1]!;
    const rejected = await request(app).post(`/v1/ops/organizations/${o.id}/payout-wallets/${pending.id}/decision`).set(reviewer.h).send({ decision: "rejected", internalNote: "no" });
    expect(rejected.status).toBe(200);
    expect((await wallets(o.id)).map((r) => r.status)).toEqual(["VERIFIED", "REVOKED"]);
    expect(fakes.email.organization.at(-1)).toMatchObject({ kind: "payout_replacement_decided", data: { decision: "rejected" } });

    await proveWallet(app, o.h, o.id, next.wallet);
    const again = (await wallets(o.id)).find((r) => r.status === "REPLACEMENT_PENDING")!;
    const approved = await request(app).post(`/v1/ops/organizations/${o.id}/payout-wallets/${again.id}/decision`).set(reviewer.h).send({ decision: "approved" });
    expect(approved.status).toBe(200);
    const rows = await wallets(o.id);
    expect(rows.filter((r) => r.status === "VERIFIED").map((r) => r.address)).toEqual([next.wallet.address]);
    expect(rows.find((r) => r.address === o.payoutWallet.address)).toMatchObject({ status: "REVOKED" });
    expect(rows.find((r) => r.id === again.id)).toMatchObject({ decidedByUserId: reviewer.userId });
    // a decided wallet cannot be decided twice
    expect((await request(app).post(`/v1/ops/organizations/${o.id}/payout-wallets/${again.id}/decision`).set(reviewer.h).send({ decision: "approved" })).status).toBe(409);
  });

  it("ops approval racing an owner entering another address leaves exactly one VERIFIED wallet", async () => {
    const reviewer = await ops(app);
    const o = await verified();
    await proveWallet(app, o.h, o.id);
    const pending = (await wallets(o.id))[1]!;
    const ctx = { userId: o.userId, sessionId: "00000000-0000-7000-8000-000000000000", meta: { requestId: "race", ip: "127.0.0.1", ipPrefix: null, userAgent: null, ipCountry: null } };
    const results = await Promise.allSettled([
      decidePayoutWallet({ userId: reviewer.userId, meta: ctx.meta }, o.id, pending.id, { decision: "approved" }),
      enterPayoutWallet(ctx, o.id, newSolanaWallet().address),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    const rows = await wallets(o.id);
    expect(rows.filter((r) => r.status === "VERIFIED")).toHaveLength(1);
    expect(rows.filter((r) => ["UNVERIFIED", "VERIFYING", "REPLACEMENT_PENDING"].includes(r.status)).length).toBeLessThanOrEqual(1);
  });
});
