import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, notificationPreferences, sessions } from "@repo/db";
import { challenges } from "../../src/modules/identity/infra/challenge-repository.js";
import { hashToken, sessionRepo } from "../../src/modules/identity/infra/session-repository.js";
import { walletRepo } from "../../src/modules/identity/infra/wallet-repository.js";
import { writeAudit } from "../../src/shared/audit.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
const meta = { requestId: "req-1", ip: "203.0.113.9", ipPrefix: "203.0.113.0/24", userAgent: "vitest" };
const PEPPER = "p".repeat(32);
beforeEach(resetDb);

async function makeChallenge(overrides: Partial<typeof authChallenges.$inferInsert> = {}) {
  const now = await challenges.dbNow(db);
  return challenges.insert(db, {
    nonce: crypto.randomUUID().replaceAll("-", ""), purpose: "sign_in", chainFamily: "evm", chain: "base", address: "0xabc",
    message: "m", domain: "d", uri: "u", chainId: "8453", issuedAt: now, expiresAt: new Date(now.getTime() + 300_000), ...overrides,
  });
}

describe("challenge state machine", () => {
  it("claim → consume once", async () => {
    const c = await makeChallenge();
    const claimA = crypto.randomUUID();
    expect(await challenges.claim(db, c.id, claimA)).toBeDefined();
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeUndefined(); // live lease
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, claimA))).toBe(true);
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, claimA))).toBe(false);
    expect((await challenges.findById(db, c.id))!.status).toBe("consumed");
  });
  it("release returns to pending; reject is terminal", async () => {
    const c = await makeChallenge();
    const k = crypto.randomUUID();
    await challenges.claim(db, c.id, k);
    await challenges.release(db, c.id, k);
    expect((await challenges.findById(db, c.id))!.status).toBe("pending");
    const k2 = crypto.randomUUID();
    await challenges.claim(db, c.id, k2);
    await challenges.reject(db, c.id, k2);
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeUndefined();
    expect((await challenges.findById(db, c.id))!.status).toBe("rejected");
  });
  it("expired lease can be re-claimed; expired challenge cannot", async () => {
    const c = await makeChallenge();
    await challenges.claim(db, c.id, crypto.randomUUID());
    await adminSql`UPDATE app.auth_challenges SET lease_expires_at = now() - interval '1 second' WHERE id = ${c.id}`;
    expect(await challenges.claim(db, c.id, crypto.randomUUID())).toBeDefined();
    const old = await makeChallenge();
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '1 second' WHERE id = ${old.id}`;
    expect(await challenges.claim(db, old.id, crypto.randomUUID())).toBeUndefined();
  });
  it("stale claimant cannot consume after lease was taken over", async () => {
    const c = await makeChallenge();
    const first = crypto.randomUUID();
    await challenges.claim(db, c.id, first);
    await adminSql`UPDATE app.auth_challenges SET lease_expires_at = now() - interval '1 second' WHERE id = ${c.id}`;
    await challenges.claim(db, c.id, crypto.randomUUID());
    expect(await db.transaction((tx) => challenges.consume(tx, c.id, first))).toBe(false);
  });
});

describe("sessions", () => {
  it("stores only the token hash and finds active sessions using DB time", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    const s = await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(row!.tokenHash).toBe(hashToken(s.token, PEPPER));
    expect(row!.tokenHash).not.toContain(s.token);
    expect((await sessionRepo.findActiveByToken(db, s.token, PEPPER))?.session.id).toBe(s.id);
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${s.id}`;
    expect(await sessionRepo.findActiveByToken(db, s.token, PEPPER)).toBeUndefined();
  });
  it("touch slides idle expiry but never beyond absolute, and only after 5 minutes", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    const s = await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    const before = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    await sessionRepo.touch(db, s.id, "web");
    const same = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(same.idleExpiresAt.getTime()).toBe(before.idleExpiresAt.getTime());
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '6 minutes', absolute_expires_at = now() + interval '1 hour' WHERE id = ${s.id}`;
    await Promise.all([sessionRepo.touch(db, s.id, "web"), sessionRepo.touch(db, s.id, "web")]);
    const after = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(after.idleExpiresAt.getTime()).toBeLessThanOrEqual(after.absoluteExpiresAt.getTime());
  });
  it("revokeAllForUser revokes every active session", async () => {
    const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
    await sessionRepo.create(db, { userId, client: "web", pepper: PEPPER, meta });
    await sessionRepo.create(db, { userId, client: "mobile", pepper: PEPPER, meta });
    expect(await sessionRepo.revokeAllForUser(db, userId, "logout_all")).toBe(2);
    expect(await sessionRepo.listActiveForUser(db, userId)).toHaveLength(0);
  });
});

describe("wallets and audit", () => {
  it("createUserWithWallet creates user, active wallet, addresses and default preferences", async () => {
    const c = await makeChallenge();
    const res = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, {
      walletProvider: "MetaMask",
      rows: [{ chain: "base", address: "0xabc", method: "eoa_ecdsa", verifiedOnChain: "base", challengeId: c.id }],
    }));
    const owner = await walletRepo.findOwner(db, "base", "0xabc");
    expect(owner).toMatchObject({ userId: res.userId, status: "active", userStatus: "active" });
    const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, res.userId));
    expect(prefs).toMatchObject({ rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false });
  });
  it("writeAudit persists correlation references", async () => {
    await writeAudit(db, { actorType: "system", action: "retention.purged", entityType: "system", entityId: "retention", requestId: "req-9", metadata: { n: 1 } });
    const [row] = await db.select().from(auditEvents);
    expect(row).toMatchObject({ requestId: "req-9", action: "retention.purged", metadata: { n: 1 } });
  });
});
