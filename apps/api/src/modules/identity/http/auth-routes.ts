import { challengeRequestSchema, verifyRequestSchema, type VerifyResponse } from "@repo/contracts";
import { Router } from "express";
import { enforceRateLimit } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import { DomainError } from "../../../shared/errors.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { issueChallenge } from "../application/challenge-service.js";
import { verifyChallenge } from "../application/sign-in-service.js";
import { optionalSession } from "./require-session.js";
import { respondWithSession } from "./session-cookie.js";

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
      client: req.auth?.client ?? body.client, auth: req.auth, meta: req.ctx,
    });
    const out: VerifyResponse = { userId: result.userId, isNewUser: result.isNewUser, ...respondWithSession(res, deps.env, req.auth?.client ?? body.client, result.issued) };
    res.json(out);
  });

  return r;
}
