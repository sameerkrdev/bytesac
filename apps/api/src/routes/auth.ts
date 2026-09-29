import createHttpError from "http-errors";
import { Router, type Response } from "express";
import { db } from "@repo/db";
import {
  SESSION_COOKIE, challengeRequestSchema, verifyRequestSchema,
  type ChallengeRequest, type VerifyRequest, type VerifyResponse,
} from "@repo/validator";
import { env } from "../env";
import { optionalSession, requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { revokeAllSessions, revokeSession } from "../services/sessions";
import { issueChallenge, verifyChallenge } from "../services/sign-in";

const cookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: "/" } as const;
const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieOptions);

export const authRouter = Router();

authRouter.post("/challenge", optionalSession, validate({ body: challengeRequestSchema }), async (req, res) => {
  const body = req.body as ChallengeRequest;
  if (body.purpose === "add_chain_account" && !req.auth) throw createHttpError(401, "Please sign in again", { code: "SESSION_EXPIRED" });
  res.json(await issueChallenge({
    purpose: body.purpose, chain: body.chain, rawAddress: body.address,
    sessionId: body.purpose === "add_chain_account" ? req.auth!.sessionId : null, meta: req.ctx,
  }));
});

authRouter.post("/verify", optionalSession, validate({ body: verifyRequestSchema }), async (req, res) => {
  const body = req.body as VerifyRequest;
  await consume(limits.verifyIp, req.ctx.ip);
  const result = await verifyChallenge({
    challengeId: body.challengeId, signature: body.signature, walletProvider: body.walletProvider,
    client: body.client, auth: req.auth, meta: req.ctx,
  });
  // sign_in issues a session for body.client; add_chain_account rotates within the caller's own client.
  // Web gets an httpOnly cookie, mobile the token in the body; no new session means keep the current one.
  const out: VerifyResponse = { userId: result.userId, isNewUser: result.isNewUser };
  if (result.issued) {
    if (result.issued.client === "web") res.cookie(SESSION_COOKIE, result.issued.token, { ...cookieOptions, expires: result.issued.absoluteExpiresAt });
    else out.token = result.issued.token;
  }
  res.json(out);
});

authRouter.post("/logout", requireSession, async (req, res) => {
  const auth = req.auth!;
  await db.transaction(async (tx) => {
    if (await revokeSession(tx, auth.sessionId, "logout")) {
      await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked", entityType: "session", entityId: auth.sessionId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { reason: "logout" } });
    }
  });
  if (auth.transport === "cookie") clearSessionCookie(res);
  res.status(204).end();
});

authRouter.post("/logout-all", requireSession, async (req, res) => {
  const auth = req.auth!;
  await db.transaction(async (tx) => {
    const n = await revokeAllSessions(tx, auth.userId, "logout_all");
    await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked_all", entityType: "user", entityId: auth.userId, requestId: req.ctx.requestId, sessionId: auth.sessionId, metadata: { count: n } });
  });
  if (auth.transport === "cookie") clearSessionCookie(res);
  res.status(204).end();
});
