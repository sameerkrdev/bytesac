import { randomBytes, randomUUID } from "node:crypto";
import createHttpError, { isHttpError } from "http-errors";
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { authChallenges, challengePurpose, db, investmentWallets, isUniqueViolation, sessions, users, walletAddresses, type Tx } from "@repo/db";
import {
  ASSET_CHAINS, CHAINS, chainsInFamily, familyOf,
  type AssetChain, type Chain, type ChainFamily, type ChallengeResponse, type ClientKind, type VerificationMethod,
} from "@repo/validator";
import { env } from "@/config/dotenv";
import type { AuthContext } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import type { RequestMeta } from "@/middlewares/request-context.middleware";
import { grantIfProven } from "@/modules/manager-applications/applications.service";
import { writeAudit } from "@/modules/audit/audit.service";
import { linkInvitesIfProven } from "@/modules/members/members.service";
import { createSession, revokeSession, type IssuedSession } from "./sessions.service";
import { buildSignInMessage } from "./sign-in-message.service";
import { verifyBitcoinProof } from "@/providers/bitcoin";
import { verifyEvmSignature, verifySolanaSignature, type VerifyOutcome } from "./signatures.service";
import { addressesForWallet, canonicalizeAddress, createUserWithWallet, findAddressOwner, insertAddresses, recordSignableChains, type NewAddressRow } from "./wallets.service";

export type ChallengeRow = typeof authChallenges.$inferSelect;
type DbPurpose = (typeof challengePurpose.enumValues)[number];

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_LEASE = "30 seconds";
/** Business rejections that make the challenge terminal (it is marked `rejected`). */
const TERMINAL = new Set(["SIGNATURE_INVALID", "ADDRESS_DISABLED", "USER_NOT_ACTIVE", "ADDRESS_ALREADY_LINKED", "CHAIN_FAMILY_ALREADY_LINKED", "CHAIN_ALREADY_LINKED", "VALIDATION_FAILED"]);

const addressLinked = () => createHttpError("This address is linked to another account", { code: "ADDRESS_ALREADY_LINKED" });
const inProgress = () => createHttpError("This sign-in request is already being verified.", { code: "CHALLENGE_IN_PROGRESS" });
/** Any non-active address is refused; a replaced one was moved to another wallet (D-120). */
const addressInactive = (status: string) => createHttpError(
  status === "replaced" ? "This address was moved to another wallet. Sign in with the wallet now linked to that chain." : "This wallet address has been disabled. Contact support.",
  { code: "ADDRESS_DISABLED" },
);

/** Database time: challenge lifetimes never depend on the API host's clock. */
async function dbNow(): Promise<Date> {
  const rows = await db.execute<{ now: string | Date }>(sql`select now() as now`);
  const v = rows[0]!.now;
  return v instanceof Date ? v : new Date(v);
}

/** `organizationId` is for payout-wallet proofs: the row is bound to the organization and the signed text is a plain custom message (not SIWS), naming it. */
export async function issueChallenge(i: { purpose: DbPurpose; chain: Chain; rawAddress: string; sessionId: string | null; organizationId?: string; chains?: AssetChain[]; meta: RequestMeta }): Promise<ChallengeResponse> {
  if (familyOf(i.chain) === "bitcoin" && i.purpose === "sign_in") throw createHttpError("Bitcoin can be linked but not used to sign in.", { code: "UNSUPPORTED_CHAIN" });
  const address = canonicalizeAddress(i.chain, i.rawAddress);
  const family = familyOf(i.chain);
  // Omitted = legacy "every chain of the family", decided at verify (a smart wallet then links only the connected chain).
  const chains = i.chains ?? (i.purpose === "reassign_chain" ? [i.chain] : null);
  if (chains && (chains.some((c) => ASSET_CHAINS[c].family !== family) || !chains.includes(i.chain))) {
    throw createHttpError("Pick chains of this wallet's network family, including the connected one.", { code: "VALIDATION_FAILED" });
  }
  await consume(limits.challengeIp, i.meta.ip);
  await consume(limits.challengeAddress, address);

  const issuedAt = await dbNow();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const nonce = randomBytes(16).toString("hex");
  const domain = env.AUTH_DOMAIN;
  const uri = env.AUTH_URI;
  const built = buildSignInMessage({ chain: i.chain, address, domain, uri, nonce, issuedAt, expiresAt, chains: chains as Chain[] | undefined });
  const chainId = built.chainId;
  const message = i.organizationId ? [
    "Bytesac payout wallet verification",
    "",
    `Verify payout wallet for Bytesac organization ${i.organizationId}. This does not sign you in or authorize any transfer.`,
    "",
    `Domain: ${domain}`,
    `Organization: ${i.organizationId}`,
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n") : built.message;

  const [row] = await db.insert(authChallenges).values({
    nonce, purpose: i.purpose, chainFamily: familyOf(i.chain), chain: i.chain, address, message, domain, uri, chainId,
    issuedAt, expiresAt, sessionId: i.sessionId, organizationId: i.organizationId, chains,
  }).returning({ id: authChallenges.id });
  return { challengeId: row!.id, message, expiresAt: expiresAt.toISOString() };
}

/** Phase A: atomically claims a pending (or lease-expired) challenge of one of `purposes`. A challenge of another purpose is reported as not found and left untouched. */
export async function claimChallenge(challengeId: string, purposes: readonly DbPurpose[]): Promise<{ ch: ChallengeRow; claimId: string }> {
  const claimId = randomUUID();
  const [ch] = await db.update(authChallenges)
    .set({ status: "processing", claimId, leaseExpiresAt: sql`now() + ${CHALLENGE_LEASE}::interval` })
    .where(and(
      eq(authChallenges.id, challengeId),
      inArray(authChallenges.purpose, purposes),
      gt(authChallenges.expiresAt, sql`now()`),
      or(eq(authChallenges.status, "pending"), and(eq(authChallenges.status, "processing"), lt(authChallenges.leaseExpiresAt, sql`now()`))),
    ))
    .returning();
  if (!ch) {
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, challengeId));
    if (!row || !purposes.includes(row.purpose)) throw createHttpError("Sign-in request not found. Start again.", { code: "CHALLENGE_NOT_FOUND" });
    if (row.status === "consumed" || row.status === "rejected") throw createHttpError("This sign-in request was already used. Start again.", { code: "CHALLENGE_CONSUMED" });
    if (row.expiresAt <= (await dbNow())) throw createHttpError("This sign-in request expired. Start again.", { code: "CHALLENGE_EXPIRED" });
    throw inProgress();
  }
  return { ch, claimId };
}

/** Marks a claimed challenge terminally rejected and audits it. */
export async function rejectChallenge(ch: ChallengeRow, claimId: string, reason: string, i: { auth?: { userId: string; sessionId: string }; meta: RequestMeta }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(authChallenges).set({ status: "rejected", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
    await writeAudit(tx, {
      actorType: i.auth ? "user" : "system", actorUserId: i.auth?.userId ?? null, action: "challenge.rejected",
      entityType: "auth_challenge", entityId: ch.id, requestId: i.meta.requestId, challengeId: ch.id,
      sessionId: i.auth?.sessionId ?? null, metadata: { reason, chain: ch.chain, address: ch.address },
    });
  });
}

export interface VerifyInput {
  challengeId: string;
  signature: string;
  walletProvider?: string;
  /** D-119: chains the wallet approved (client-reported); omitted = unknown, existing value kept. */
  signableChains?: AssetChain[];
  client: ClientKind;
  auth?: AuthContext;
  meta: RequestMeta;
  /** Bitcoin links only: the signing method and the address the caller claims (must equal the challenge address). */
  bitcoin?: { method: "bip322" | "bip137"; address: string };
}
export interface VerifyResult { userId: string; isNewUser: boolean; issued: IssuedSession | null }

/** Three phases: claim the challenge, verify the signature outside any transaction, then finalize atomically. */
export async function verifyChallenge(input: VerifyInput): Promise<VerifyResult> {
  const { ch, claimId } = await claimChallenge(input.challengeId, ["sign_in", "add_chain_account"]);

  try {
    if (ch.purpose === "add_chain_account" && (!input.auth || input.auth.sessionId !== ch.sessionId)) {
      throw createHttpError("This challenge belongs to another session", { code: "SIGNATURE_INVALID" });
    }

    // Phase B: verify outside any transaction
    let outcome: VerifyOutcome;
    try {
      const request = { chain: ch.chain, address: ch.address, message: ch.message, signature: input.signature };
      const family = familyOf(ch.chain);
      if (family === "bitcoin") {
        const btc = input.bitcoin;
        if (!btc) throw createHttpError("Bitcoin addresses are linked through the Bitcoin endpoints.", { code: "VALIDATION_FAILED" });
        outcome = btc.address === ch.address && verifyBitcoinProof({ address: ch.address, message: ch.message, signature: input.signature, method: btc.method })
          ? { kind: "valid", method: btc.method } : { kind: "invalid" };
      } else outcome = family === "evm" ? await verifyEvmSignature(request) : verifySolanaSignature(request);
    } catch (err) {
      // The signature was not judged (e.g. RPC outage): release the claim so the same signature can be retried.
      await db.update(authChallenges).set({ status: "pending", claimId: null, leaseExpiresAt: null })
        .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
      throw err;
    }
    if (outcome.kind === "invalid") throw createHttpError("Signature could not be verified", { code: "SIGNATURE_INVALID" });

    // Phase C: finalize atomically; a sign-up race on the address unique index is retried once.
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction((tx) => finalize(tx, ch, claimId, outcome.method, input));
      } catch (err) {
        if (!isUniqueViolation(err, "wallet_addresses_chain_address_key")) throw err;
        if (attempt === 2 || ch.purpose !== "sign_in") throw addressLinked();
      }
    }
  } catch (err) {
    if (isHttpError(err) && TERMINAL.has(err.code)) await rejectChallenge(ch, claimId, err.code, input);
    throw err;
  }
}

async function finalize(tx: Tx, ch: ChallengeRow, claimId: string, method: VerificationMethod, input: VerifyInput): Promise<VerifyResult> {
  const consumed = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
    .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")))
    .returning({ id: authChallenges.id });
  if (consumed.length !== 1) throw inProgress();

  // D-120: link exactly the chains the user ticked. Only an ECDSA-recovered EOA key (or ed25519) proves control on several chains; contract wallets are per chain.
  const explicit = ch.chains !== null;
  const multiChain = method === "eoa_ecdsa" || method === "ed25519";
  const wanted = (ch.chains ?? (method === "eoa_ecdsa" ? chainsInFamily(familyOf(ch.chain)) : [ch.chain])) as Chain[];
  if (!multiChain && !(wanted.length === 1 && wanted[0] === ch.chain)) throw createHttpError("Smart-contract wallets link one chain at a time.", { code: "VALIDATION_FAILED" });
  const rows: NewAddressRow[] = wanted.map((chain) => ({
    chain, address: ch.address, method, verifiedOnChain: ch.chain, challengeId: ch.id, walletName: input.walletProvider ?? null,
  }));
  const audit = { requestId: input.meta.requestId, challengeId: ch.id };

  if (ch.purpose === "sign_in") {
    let userId: string;
    let isNewUser = false;
    // One key = one account: the owner is whoever holds this address on ANY chain of its family, not just the connected one.
    const found = await addressRows(tx, ch.address, familyOf(ch.chain));
    if (found.length > 0) {
      const target = (found.find((r) => r.status === "active") ?? found[0]!);
      // Lock the wallet, then judge status on a fresh read so a concurrent disable/reassign cannot yield a session.
      await tx.select({ id: investmentWallets.id }).from(investmentWallets).where(eq(investmentWallets.id, target.walletId)).for("update");
      const fresh = await addressRows(tx, ch.address, familyOf(ch.chain));
      const owner = fresh.find((r) => r.status === "active" && r.walletId === target.walletId);
      if (!owner) throw addressInactive(fresh.some((r) => r.status === "replaced") ? "replaced" : "disabled");
      if (owner.userStatus !== "active") throw createHttpError("This account is not active", { code: "USER_NOT_ACTIVE" });
      userId = owner.userId;
      // Add ticked chains the account lacks. Without an explicit tick (legacy) a clash is skipped, never a sign-in failure.
      const added = await linkMissing(tx, owner.walletId, ch, rows, explicit);
      if (added.length > 0) {
        await writeAudit(tx, {
          ...audit, actorType: "user", actorUserId: userId, action: "wallet.chain_account_added", entityType: "investment_wallet",
          entityId: owner.walletId, metadata: { chain: ch.chain, address: ch.address, method, chains: added.map((r) => r.chain) },
        });
      }
    } else {
      userId = await createUserWithWallet(tx, { walletProvider: input.walletProvider, rows });
      isNewUser = true;
      await writeAudit(tx, {
        ...audit, actorType: "user", actorUserId: userId, action: "user.signed_up", entityType: "user", entityId: userId,
        metadata: { chain: ch.chain, address: ch.address, method, chains: rows.map((r) => r.chain) },
      });
    }
    await recordSignableChains(tx, ch.chain, ch.address, input.signableChains);
    await grantIfProven(tx, { userId, chain: ch.chain, address: ch.address, method, requestId: input.meta.requestId });
    await linkInvitesIfProven(tx, { userId, chain: ch.chain, address: ch.address, method, requestId: input.meta.requestId });
    const issued = await createSession(tx, { userId, client: input.client, pepper: env.SESSION_TOKEN_PEPPER, meta: input.meta });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "session.created", entityType: "session", entityId: issued.id, sessionId: issued.id, metadata: { client: input.client } });
    await writeAudit(tx, { ...audit, actorType: "user", actorUserId: userId, action: "user.signed_in", entityType: "user", entityId: userId, sessionId: issued.id, metadata: { chain: ch.chain, method } });
    return { userId, isNewUser, issued };
  }

  // add_chain_account
  const auth = input.auth!;
  const owner = await findAddressOwner(tx, ch.chain, ch.address);
  if (owner) {
    if (owner.userId !== auth.userId) throw addressLinked();
    if (owner.status !== "active") throw addressInactive(owner.status);
  }
  // Row-lock the active wallet to serialize concurrent address additions for one user.
  const [wallet] = await tx.select({ id: investmentWallets.id }).from(investmentWallets)
    .where(and(eq(investmentWallets.userId, auth.userId), eq(investmentWallets.status, "active"))).for("update");
  if (!wallet) throw createHttpError("No active investment wallet", { code: "USER_NOT_ACTIVE" });
  const toInsert = await linkMissing(tx, wallet.id, ch, rows, explicit);
  if (toInsert.length === 0) { // idempotent: nothing new, no rotation
    await recordSignableChains(tx, ch.chain, ch.address, input.signableChains);
    return { userId: auth.userId, isNewUser: false, issued: null };
  }
  await recordSignableChains(tx, ch.chain, ch.address, input.signableChains);
  await grantIfProven(tx, { userId: auth.userId, chain: ch.chain, address: ch.address, method, requestId: input.meta.requestId });
  await linkInvitesIfProven(tx, { userId: auth.userId, chain: ch.chain, address: ch.address, method, requestId: input.meta.requestId });
  await writeAudit(tx, {
    ...audit, actorType: "user", actorUserId: auth.userId, action: "wallet.chain_account_added", entityType: "investment_wallet",
    entityId: wallet.id, sessionId: auth.sessionId, metadata: { chain: ch.chain, address: ch.address, method, chains: toInsert.map((r) => r.chain) },
  });

  // Rotate the session. Revoke first: if it is already revoked (e.g. concurrent logout) refuse and roll everything back.
  if (!(await revokeSession(tx, auth.sessionId, "rotated"))) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
  const issued = await createSession(tx, { userId: auth.userId, client: auth.client, pepper: env.SESSION_TOKEN_PEPPER, meta: input.meta });
  await tx.update(sessions).set({ replacedBySessionId: issued.id }).where(eq(sessions.id, auth.sessionId));
  await writeAudit(tx, {
    actorType: "user", actorUserId: auth.userId, action: "session.rotated", entityType: "session", entityId: issued.id,
    requestId: input.meta.requestId, sessionId: issued.id, metadata: { previousSessionId: auth.sessionId },
  });
  return { userId: auth.userId, isNewUser: false, issued };
}

/**
 * Inserts the wanted rows the wallet lacks and returns them. `explicit` (or the connected chain): a wanted chain held by another address, another wallet or a non-active row of this address is an error;
 * otherwise (legacy, no explicit tick) such chains are skipped. The caller holds the wallet row lock.
 */
async function linkMissing(tx: Tx, walletId: string, ch: ChallengeRow, rows: NewAddressRow[], explicit: boolean): Promise<NewAddressRow[]> {
  const existing = await addressesForWallet(tx, walletId);
  if (familyOf(ch.chain) === "bitcoin" && existing.some((a) => a.chainFamily === "bitcoin" && a.status === "active" && a.address !== ch.address)) {
    throw createHttpError("A different address in this chain family is already linked", { code: "CHAIN_FAMILY_ALREADY_LINKED" });
  }
  const taken = await tx.select({ chain: walletAddresses.chain, walletId: walletAddresses.investmentWalletId, status: walletAddresses.status }).from(walletAddresses)
    .where(and(eq(walletAddresses.address, ch.address), inArray(walletAddresses.chain, rows.map((r) => r.chain))));
  const toInsert: NewAddressRow[] = [];
  for (const r of rows) {
    const row = taken.find((t) => t.chain === r.chain);
    const strict = explicit || r.chain === ch.chain; // the connected chain is always asked for
    if (row?.walletId === walletId && row.status === "active") continue; // already linked
    if (existing.some((a) => a.status === "active" && a.chain === r.chain && a.address !== ch.address)) {
      if (!strict) continue;
      throw createHttpError(`${CHAINS[r.chain].label} is already linked to another wallet. Move it first.`, { code: "CHAIN_ALREADY_LINKED" });
    }
    if (row) {
      if (!strict) continue;
      if (row.walletId !== walletId) throw addressLinked();
      throw addressInactive(row.status);
    }
    toInsert.push(r);
  }
  await insertAddresses(tx, walletId, toInsert);
  return toInsert;
}

/** Every row of this address in its chain family, with the owning wallet and user. */
async function addressRows(tx: Tx, address: string, family: ChainFamily) {
  return tx.select({ userId: users.id, userStatus: users.status, walletId: investmentWallets.id, status: walletAddresses.status })
    .from(walletAddresses)
    .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
    .innerJoin(users, eq(users.id, investmentWallets.userId))
    .where(and(eq(walletAddresses.address, address), eq(walletAddresses.chainFamily, family)));
}
