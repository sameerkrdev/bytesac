import { and, eq, isNull, ne } from "drizzle-orm";
import createHttpError from "http-errors";
import { Router } from "express";
import { contacts, db, investmentWallets, sessions, userPermissions, users } from "@repo/db";
import { familyOf, z, type MeResponse, type SessionsResponse } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { contactView } from "../services/contacts";
import { activeRoles } from "../services/platform-roles";
import { listActiveSessions, revokeSession } from "../services/sessions";
import { addressesForWallet } from "../services/wallets";

export const meRouter = Router();
meRouter.use(requireSession);

meRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [wallet] = await db.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
  if (!user || !wallet) throw createHttpError("This account is not active", { code: "USER_NOT_ACTIVE" });
  const addresses = await addressesForWallet(db, wallet.id);
  const current = await db.select().from(contacts).where(and(eq(contacts.userId, userId), ne(contacts.status, "replaced")));
  const body: MeResponse = {
    user: { id: user.id, status: user.status, createdAt: user.createdAt.toISOString() },
    wallet: {
      id: wallet.id,
      walletProvider: wallet.walletProvider,
      addresses: addresses.map((a) => ({
        chain: a.chain, chainFamily: familyOf(a.chain), address: a.address, status: a.status,
        verificationMethod: a.verificationMethod, verifiedAt: a.verifiedAt.toISOString(),
      })),
    },
    contacts: current.map(contactView),
    permissions: (await db.select({ permission: userPermissions.permission }).from(userPermissions).where(and(eq(userPermissions.userId, userId), isNull(userPermissions.revokedAt)))).map((p) => p.permission),
    platformRoles: await activeRoles(db, userId),
  };
  res.json(body);
});

meRouter.get("/sessions", async (req, res) => {
  const rows = await listActiveSessions(db, req.auth!.userId);
  const body: SessionsResponse = {
    sessions: rows.map((s) => ({
      id: s.id, client: s.client, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
      userAgent: s.userAgent, ipPrefix: s.ipPrefix, current: s.id === req.auth!.sessionId,
    })),
  };
  res.json(body);
});

meRouter.delete("/sessions/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  const id = (req.params.id as string);
  const [owned] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, req.auth!.userId)));
  if (!owned) throw createHttpError("Session not found", { code: "NOT_FOUND" });
  await db.transaction(async (tx) => {
    if (await revokeSession(tx, id, "user_revoked")) {
      await writeAudit(tx, { actorType: "user", actorUserId: req.auth!.userId, action: "session.revoked", entityType: "session", entityId: id, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { reason: "user_revoked" } });
    }
  });
  res.status(204).end();
});
