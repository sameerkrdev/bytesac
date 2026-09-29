import { familyOf, type MeResponse, type SessionsResponse } from "@repo/contracts";
import { and, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../../../deps.js";
import { contacts, sessions, users } from "../../../db/schema/index.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { toIso, toIsoOrNull } from "../../../shared/time.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { sessionRepo } from "../infra/session-repository.js";
import { walletRepo } from "../infra/wallet-repository.js";
import { requireSession } from "./require-session.js";

export function meRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));

  r.get("/", async (req, res) => {
    const userId = req.auth!.userId;
    const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
    const wallet = await walletRepo.activeWalletForUser(deps.db, userId);
    if (!user || !wallet) throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
    const addresses = await walletRepo.addressesForWallet(deps.db, wallet.id);
    const current = await deps.db.select().from(contacts).where(and(eq(contacts.userId, userId), ne(contacts.status, "replaced")));
    const body: MeResponse = {
      user: { id: user.id, status: user.status, createdAt: toIso(user.createdAt) },
      wallet: {
        id: wallet.id,
        walletProvider: wallet.walletProvider,
        addresses: addresses.map((a) => ({
          chain: a.chain, chainFamily: familyOf(a.chain), address: a.address, status: a.status,
          verificationMethod: a.verificationMethod, verifiedAt: toIso(a.verifiedAt),
        })),
      },
      contacts: current.map((c) => ({ id: c.id, type: c.type, value: c.value, status: c.status === "verified" ? "verified" : "unverified", verifiedAt: toIsoOrNull(c.verifiedAt) })),
    };
    res.json(body);
  });

  r.get("/sessions", async (req, res) => {
    const rows = await sessionRepo.listActiveForUser(deps.db, req.auth!.userId);
    const body: SessionsResponse = {
      sessions: rows.map((s) => ({
        id: s.id, client: s.client, createdAt: toIso(s.createdAt), lastSeenAt: toIso(s.lastSeenAt),
        userAgent: s.userAgent, ipPrefix: s.ipPrefix, current: s.id === req.auth!.sessionId,
      })),
    };
    res.json(body);
  });

  r.delete("/sessions/:id", async (req, res) => {
    const { id } = parseOrThrow(z.object({ id: z.uuid() }), req.params);
    const [owned] = await deps.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, req.auth!.userId)));
    if (!owned) throw new DomainError("NOT_FOUND", "Session not found");
    await sessionRepo.revoke(deps.db, id, "user_revoked");
    await writeAudit(deps.db, { actorType: "user", actorUserId: req.auth!.userId, action: "session.revoked", entityType: "session", entityId: id, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { reason: "user_revoked" } });
    res.status(204).end();
  });

  return r;
}
