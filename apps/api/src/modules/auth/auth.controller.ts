import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, type ChallengeRequest, type VerifyRequest, type BitcoinChallengeRequest, type BitcoinVerify, type VerifyResponse } from "@repo/validator";
import createHttpError from "http-errors";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { bip322ToSignPsbt } from "@/providers/bitcoin";
import type { VerifyResult } from "./sign-in.service";
import { env } from "@/config/dotenv";
import * as signInService from "./sign-in.service";
import * as sessionsService from "./sessions.service";
import * as walletsService from "./wallets.service";

const cookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: "/" } as const;

const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieOptions);

/**
 * sign_in issues a session for the requested client; add_chain_account rotates within the caller's own client.
 * Web gets an httpOnly cookie, mobile the token in the body; no new session means keep the current one.
 */
function respondVerified(res: Response, result: VerifyResult): void {
  const out: VerifyResponse = { userId: result.userId, isNewUser: result.isNewUser };
  if (result.issued) {
    if (result.issued.client === "web") res.cookie(SESSION_COOKIE, result.issued.token, { ...cookieOptions, expires: result.issued.absoluteExpiresAt });
    else out.token = result.issued.token;
  }
  res.json(out);
}

export const requestChallenge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as ChallengeRequest;
    if (body.purpose === "add_chain_account" && !req.auth) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
    res.json(await signInService.issueChallenge({
      purpose: body.purpose, chain: body.chain, rawAddress: body.address, chains: body.chains,
      sessionId: body.purpose === "add_chain_account" ? req.auth!.sessionId : null, meta: req.ctx,
    }));
  } catch (error) {
    next(error);
  }
};

export const verifySignature = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as VerifyRequest;
    await consume(limits.verifyIp, req.ctx.ip);
    const result = await signInService.verifyChallenge({
      challengeId: body.challengeId, signature: body.signature, walletProvider: body.walletProvider, signableChains: body.signableChains,
      client: body.client, auth: req.auth, meta: req.ctx,
    });
    respondVerified(res, result);
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = req.auth!;
    await sessionsService.logoutSession(auth, req.ctx.requestId);
    if (auth.transport === "cookie") clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const logoutAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = req.auth!;
    await sessionsService.logoutAllSessions(auth, req.ctx.requestId);
    if (auth.transport === "cookie") clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const requestBitcoinChallenge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.body as BitcoinChallengeRequest;
    await consume(limits.bitcoinLinkUser, req.auth!.userId);
    const challenge = await signInService.issueChallenge({ purpose: "add_chain_account", chain: "bitcoin", rawAddress: address, sessionId: req.auth!.sessionId, meta: req.ctx });
    res.json({ ...challenge, toSignPsbt: bip322ToSignPsbt(walletsService.canonicalBitcoinAddress(address), challenge.message) });
  } catch (error) {
    next(error);
  }
};

export const verifyBitcoinChallenge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as BitcoinVerify;
    await consume(limits.bitcoinLinkUser, req.auth!.userId);
    respondVerified(res, await signInService.verifyChallenge({
      challengeId: body.challengeId, signature: body.signature, client: req.auth!.client, auth: req.auth, meta: req.ctx,
      bitcoin: { method: body.method, address: walletsService.canonicalBitcoinAddress(body.address) },
    }));
  } catch (error) {
    next(error);
  }
};

export const listSessions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await sessionsService.listOwnSessions(req.auth!));
  } catch (error) {
    next(error);
  }
};

export const revokeOwnSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sessionsService.revokeOwnSession(req.auth!, req.ctx.requestId, req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
