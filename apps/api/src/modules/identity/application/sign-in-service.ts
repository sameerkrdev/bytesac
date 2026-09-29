import { randomUUID } from "node:crypto";
import { familyOf, type ClientKind, type VerificationMethod } from "@repo/contracts";
import { VerifierUnavailableError } from "../../../adapters/evm-rpc.js";
import type { Tx } from "../../../db/client.js";
import type { AppDeps } from "../../../deps.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { isUniqueViolation } from "../../../shared/pg-errors.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { chainsForVerification } from "../domain/verification-scope.js";
import { challenges, type ChallengeRow } from "../infra/challenge-repository.js";
import { sessionRepo, type IssuedSession } from "../infra/session-repository.js";
import { createSignatureVerifier } from "../infra/signature-verifier.js";
import { walletRepo, type NewAddressRow } from "../infra/wallet-repository.js";
import type { AuthContext } from "../http/require-session.js";
import { rotateSession } from "./session-service.js";

export interface VerifyInput {
  challengeId: string;
  signature: string;
  walletProvider?: string;
  client: ClientKind;
  auth?: AuthContext;
  meta: RequestMeta;
}
export interface VerifyResult { userId: string; isNewUser: boolean; issued: IssuedSession | null }

/** Business rejections that make the challenge terminal (it is marked `rejected`). */
const TERMINAL = new Set(["SIGNATURE_INVALID", "ADDRESS_DISABLED", "USER_NOT_ACTIVE", "ADDRESS_ALREADY_LINKED", "CHAIN_FAMILY_ALREADY_LINKED"]);

export async function verifyChallenge(deps: AppDeps, input: VerifyInput): Promise<VerifyResult> {
  // Phase A — claim
  const claimId = randomUUID();
  const ch = await challenges.claim(deps.db, input.challengeId, claimId);
  if (!ch) throw await claimFailure(deps, input.challengeId);

  try {
    if (ch.purpose === "add_chain_account" && (!input.auth || input.auth.sessionId !== ch.sessionId)) {
      throw new DomainError("SIGNATURE_INVALID", "This challenge belongs to another session");
    }

    // Phase B — verify outside any transaction
    let outcome;
    try {
      outcome = await createSignatureVerifier(deps.evmRpc).verify({ chain: ch.chain, address: ch.address, message: ch.message, signature: input.signature });
    } catch (err) {
      if (err instanceof VerifierUnavailableError) {
        await challenges.release(deps.db, ch.id, claimId);
        throw new DomainError("VERIFIER_UNAVAILABLE", "Wallet verification is temporarily unavailable. Please try again.");
      }
      throw err;
    }
    if (outcome.kind === "invalid") throw new DomainError("SIGNATURE_INVALID", "Signature could not be verified");

    // Phase C — finalize atomically (retry once on sign-up race)
    try {
      return await deps.db.transaction((tx) => finalize(deps, tx, ch, claimId, outcome.method, input));
    } catch (err) {
      if (ch.purpose === "sign_in" && isUniqueViolation(err, "wallet_addresses_chain_address_key")) {
        return await deps.db.transaction((tx) => finalize(deps, tx, ch, claimId, outcome.method, input));
      }
      if (ch.purpose === "add_chain_account" && isUniqueViolation(err, "wallet_addresses_chain_address_key")) {
        throw new DomainError("ADDRESS_ALREADY_LINKED", "This address is linked to another account");
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof DomainError && TERMINAL.has(err.code)) {
      await challenges.reject(deps.db, ch.id, claimId);
      await writeAudit(deps.db, {
        actorType: input.auth ? "user" : "system", actorUserId: input.auth?.userId ?? null, action: "challenge.rejected",
        entityType: "auth_challenge", entityId: ch.id, requestId: input.meta.requestId, challengeId: ch.id,
        sessionId: input.auth?.sessionId ?? null, metadata: { reason: err.code, chain: ch.chain, address: ch.address },
      });
    }
    throw err;
  }
}

async function claimFailure(deps: AppDeps, id: string): Promise<DomainError> {
  const row = await challenges.findById(deps.db, id);
  const now = await challenges.dbNow(deps.db);
  if (!row) return new DomainError("CHALLENGE_NOT_FOUND", "Sign-in request not found. Start again.");
  if (row.status === "consumed" || row.status === "rejected") return new DomainError("CHALLENGE_CONSUMED", "This sign-in request was already used. Start again.");
  if (row.expiresAt <= now) return new DomainError("CHALLENGE_EXPIRED", "This sign-in request expired. Start again.");
  return new DomainError("CHALLENGE_IN_PROGRESS", "This sign-in request is already being verified.");
}

async function finalize(deps: AppDeps, tx: Tx, ch: ChallengeRow, claimId: string, method: VerificationMethod, input: VerifyInput): Promise<VerifyResult> {
  if (!(await challenges.consume(tx, ch.id, claimId))) {
    throw new DomainError("CHALLENGE_IN_PROGRESS", "This sign-in request is already being verified.");
  }
  const rows: NewAddressRow[] = chainsForVerification(method, ch.chain).map((chain) => ({
    chain, address: ch.address, method, verifiedOnChain: ch.chain, challengeId: ch.id,
  }));
  const owner = await walletRepo.findOwner(tx, ch.chain, ch.address);
  const audit = { requestId: input.meta.requestId, challengeId: ch.id };

  if (ch.purpose === "sign_in") {
    let userId: string;
    let isNewUser = false;
    if (owner) {
      if (owner.status === "disabled") throw new DomainError("ADDRESS_DISABLED", "This wallet address has been disabled. Contact support.");
      if (owner.userStatus !== "active") throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
      userId = owner.userId;
    } else {
      ({ userId } = await walletRepo.createUserWithWallet(tx, { walletProvider: input.walletProvider, rows }));
      isNewUser = true;
      await writeAudit(tx, {
        ...audit, actorType: "user", actorUserId: userId, action: "user.signed_up", entityType: "user", entityId: userId,
        metadata: { chain: ch.chain, address: ch.address, method, chains: rows.map((r) => r.chain) },
      });
    }
    const issued = await sessionRepo.create(tx, { userId, client: input.client, pepper: deps.env.SESSION_TOKEN_PEPPER, meta: input.meta });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "session.created", entityType: "session", entityId: issued.id, sessionId: issued.id, metadata: { client: input.client } });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "user.signed_in", entityType: "user", entityId: userId, sessionId: issued.id, metadata: { chain: ch.chain, method } });
    return { userId, isNewUser, issued };
  }

  // add_chain_account
  const auth = input.auth!;
  if (owner) {
    if (owner.userId !== auth.userId) throw new DomainError("ADDRESS_ALREADY_LINKED", "This address is linked to another account");
    return { userId: auth.userId, isNewUser: false, issued: null }; // idempotent: no rotation
  }
  const wallet = await walletRepo.activeWalletForUser(tx, auth.userId);
  if (!wallet) throw new DomainError("USER_NOT_ACTIVE", "No active investment wallet");
  const existing = await walletRepo.addressesForWallet(tx, wallet.id);
  const family = familyOf(ch.chain);
  if (existing.some((a) => a.chainFamily === family && a.address !== ch.address)) {
    throw new DomainError("CHAIN_FAMILY_ALREADY_LINKED", "A different address in this chain family is already linked");
  }
  const have = new Set(existing.filter((a) => a.address === ch.address).map((a) => a.chain));
  const toInsert = rows.filter((r) => !have.has(r.chain));
  await walletRepo.insertAddresses(tx, wallet.id, toInsert);
  await writeAudit(tx, {
    ...audit, actorType: "user", actorUserId: auth.userId, action: "wallet.chain_account_added", entityType: "investment_wallet",
    entityId: wallet.id, sessionId: auth.sessionId, metadata: { chain: ch.chain, address: ch.address, method, chains: toInsert.map((r) => r.chain) },
  });
  const issued = await rotateSession(tx, { userId: auth.userId, oldSessionId: auth.sessionId, client: auth.client, pepper: deps.env.SESSION_TOKEN_PEPPER, meta: input.meta });
  return { userId: auth.userId, isNewUser: false, issued };
}
