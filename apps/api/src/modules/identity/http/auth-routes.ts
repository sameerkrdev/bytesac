import { challengeRequestSchema, verifyRequestSchema, type VerifyResponse } from "@repo/validator";
import { Router } from "express";
import { enforceRateLimit } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import { DomainError } from "../../../shared/errors.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { issueChallenge } from "../application/challenge-service.js";
import { verifyChallenge } from "../application/sign-in-service.js";
import { writeAudit } from "../../../shared/audit.js";
import { sessionRepo } from "../infra/session-repository.js";
import { optionalSession, requireSession } from "./require-session.js";
import { clearSessionCookie, respondWithSession } from "./session-cookie.js";

export function authRouter(deps: AppDeps): Router {
  const r = Router();

  r.post("/challenge", optionalSession(deps), async (req, res) => {
    const body = parseOrThrow(challengeRequestSchema, req.body);
    if (body.purpose === "add_chain_account" && !req.auth) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
    const out = await issueChallenge(deps, {
      purpose: body.purpose, chain: body.chain, rawAddress: body.address,
      sessionId: body.purpose === "add_chain_account" ? req.auth!.sessionId : null, meta: req.ctx,
    });
    res.json(out);
  });

  r.post("/verify", optionalSession(deps), async (req, res) => {
    const body = parseOrThrow(verifyRequestSchema, req.body);
    await enforceRateLimit(deps.rateLimiter, `verify:ip:${req.ctx.ip}`, 30, 60);
    const result = await verifyChallenge(deps, {
      challengeId: body.challengeId, signature: body.signature, walletProvider: body.walletProvider,
      client: body.client, auth: req.auth, meta: req.ctx,
    });
    // sign_in issues a session for body.client; add_chain_account rotates within the caller's own client.
    const sessionClient = result.issued?.client ?? body.client;
    const out: VerifyResponse = { userId: result.userId, isNewUser: result.isNewUser, ...respondWithSession(res, deps.env, sessionClient, result.issued) };
    res.json(out);
  });

  r.post("/logout", requireSession(deps), async (req, res) => {
    const auth = req.auth!;
    await deps.db.transaction(async (tx) => {
      const revoked = await sessionRepo.revoke(tx, auth.sessionId, "logout");
      if (revoked) await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked", entityType: "session", entityId: auth.sessionId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { reason: "logout" } });
    });
    if (auth.transport === "cookie") clearSessionCookie(res, deps.env);
    res.status(204).end();
  });

  r.post("/logout-all", requireSession(deps), async (req, res) => {
    const auth = req.auth!;
    await deps.db.transaction(async (tx) => {
      const n = await sessionRepo.revokeAllForUser(tx, auth.userId, "logout_all");
      await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked_all", entityType: "user", entityId: auth.userId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { count: n } });
    });
    if (auth.transport === "cookie") clearSessionCookie(res, deps.env);
    res.status(204).end();
  });

  return r;
}
