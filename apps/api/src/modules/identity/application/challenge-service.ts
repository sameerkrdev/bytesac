import { randomBytes } from "node:crypto";
import { familyOf, type Chain, type ChallengePurpose, type ChallengeResponse } from "@repo/contracts";
import { enforceRateLimit } from "../../../adapters/rate-limiter.js";
import type { AppDeps } from "../../../deps.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { canonicalizeAddress } from "../domain/address.js";
import { buildSignInMessage } from "../domain/sign-in-message.js";
import { challenges } from "../infra/challenge-repository.js";

const TTL_MS = 5 * 60 * 1000;

export async function issueChallenge(
  deps: AppDeps,
  i: { purpose: ChallengePurpose; chain: Chain; rawAddress: string; sessionId: string | null; meta: RequestMeta },
): Promise<ChallengeResponse> {
  const address = canonicalizeAddress(i.chain, i.rawAddress);
  await enforceRateLimit(deps.rateLimiter, `challenge:ip:${i.meta.ip}`, 20, 60);
  await enforceRateLimit(deps.rateLimiter, `challenge:addr:${address}`, 10, 60);

  const issuedAt = await challenges.dbNow(deps.db);
  const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
  const nonce = randomBytes(16).toString("hex");
  const domain = deps.env.AUTH_DOMAIN;
  const uri = deps.env.AUTH_URI;
  const { message, chainId } = buildSignInMessage({ chain: i.chain, address, domain, uri, nonce, issuedAt, expiresAt });

  const row = await challenges.insert(deps.db, {
    nonce, purpose: i.purpose, chainFamily: familyOf(i.chain), chain: i.chain, address, message, domain, uri, chainId,
    issuedAt, expiresAt, sessionId: i.sessionId,
  });
  return { challengeId: row.id, message, expiresAt: expiresAt.toISOString() };
}
