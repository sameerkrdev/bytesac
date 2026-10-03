import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, authChallenges, notificationPreferences, sessions } from "@repo/db";
import { writeAudit } from "@/modules/audit/audit.service";
import { createSession, hashToken, findActiveSession, listActiveSessions, revokeAllSessions, touchSession } from "@/modules/auth/sessions.service";
import { createUserWithWallet, findAddressOwner } from "@/modules/auth/wallets.service";
import { adminSql, resetDb, testDb } from "../../helpers/db";

const db = testDb.db;
const meta = { requestId: "req-1", ip: "203.0.113.9", ipPrefix: "203.0.113.0/24", userAgent: "vitest", ipCountry: null };
const PEPPER = "p".repeat(32);
beforeEach(resetDb);

describe("sessions", () => {
  it("stores only the token hash and finds active sessions using DB time", async () => {
    const userId = await db.transaction((tx) => createUserWithWallet(tx, { rows: [] }));
    const s = await createSession(db, { userId, client: "web", pepper: PEPPER, meta });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(row!.tokenHash).toBe(hashToken(s.token, PEPPER));
    expect(row!.tokenHash).not.toContain(s.token);
    expect((await findActiveSession(db, s.token, PEPPER))?.session.id).toBe(s.id);
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${s.id}`;
    expect(await findActiveSession(db, s.token, PEPPER)).toBeUndefined();
  });
  it("touch slides idle expiry but never beyond absolute, and only after 5 minutes", async () => {
    const userId = await db.transaction((tx) => createUserWithWallet(tx, { rows: [] }));
    const s = await createSession(db, { userId, client: "web", pepper: PEPPER, meta });
    const before = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    await touchSession(db, s.id, "web");
    const same = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(same.idleExpiresAt.getTime()).toBe(before.idleExpiresAt.getTime());
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '6 minutes', absolute_expires_at = now() + interval '1 hour' WHERE id = ${s.id}`;
    await Promise.all([touchSession(db, s.id, "web"), touchSession(db, s.id, "web")]);
    const after = (await db.select().from(sessions).where(eq(sessions.id, s.id)))[0]!;
    expect(after.idleExpiresAt.getTime()).toBeLessThanOrEqual(after.absoluteExpiresAt.getTime());
  });
  it("session lifetimes per client", async () => {
    const userId = await db.transaction((tx) => createUserWithWallet(tx, { rows: [] }));
    const web = await createSession(db, { userId, client: "web", pepper: PEPPER, meta });
    const mobile = await createSession(db, { userId, client: "mobile", pepper: PEPPER, meta });
    const hours = async (id: string, column: "idle_expires_at" | "absolute_expires_at") =>
      (await adminSql<{ d: number }[]>`SELECT round(extract(epoch from ${adminSql(column)} - created_at) / 3600)::int AS d FROM app.sessions WHERE id = ${id}`)[0]!.d;
    expect([await hours(web.id, "idle_expires_at"), await hours(web.id, "absolute_expires_at")]).toEqual([12, 168]);
    expect([await hours(mobile.id, "idle_expires_at"), await hours(mobile.id, "absolute_expires_at")]).toEqual([168, 720]);
  });
  it("revokeAllSessions revokes every active session", async () => {
    const userId = await db.transaction((tx) => createUserWithWallet(tx, { rows: [] }));
    await createSession(db, { userId, client: "web", pepper: PEPPER, meta });
    await createSession(db, { userId, client: "mobile", pepper: PEPPER, meta });
    expect(await revokeAllSessions(db, userId, "logout_all")).toBe(2);
    expect(await listActiveSessions(db, userId)).toHaveLength(0);
  });
});

describe("wallets and audit", () => {
  it("createUserWithWallet creates user, active wallet, addresses and default preferences", async () => {
    const now = new Date();
    const [c] = await db.insert(authChallenges).values({
      nonce: crypto.randomUUID().replaceAll("-", ""), purpose: "sign_in", chainFamily: "evm", chain: "base", address: "0xabc",
      message: "m", domain: "d", uri: "u", chainId: "8453", issuedAt: now, expiresAt: new Date(now.getTime() + 300_000),
    }).returning();
    const userId = await db.transaction((tx) => createUserWithWallet(tx, {
      walletProvider: "MetaMask",
      rows: [{ chain: "base", address: "0xabc", method: "eoa_ecdsa", verifiedOnChain: "base", challengeId: c!.id }],
    }));
    const owner = await findAddressOwner(db, "base", "0xabc");
    expect(owner).toMatchObject({ userId, status: "active", userStatus: "active" });
    const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    expect(prefs).toMatchObject({ rebalance: true, portfolioUpdates: true, managerUpdates: true, offers: false, productUpdates: false, marketing: false });
  });
  it("writeAudit persists correlation references", async () => {
    await writeAudit(db, { actorType: "system", action: "test.event", entityType: "system", entityId: "x", requestId: "req-9", metadata: { n: 1 } });
    const [row] = await db.select().from(auditEvents);
    expect(row).toMatchObject({ requestId: "req-9", action: "test.event", metadata: { n: 1 } });
  });
});
