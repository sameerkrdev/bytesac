import createHttpError, { isHttpError } from "http-errors";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { authChallenges, db, instrumentDeployments, instruments, investmentWallets, isUniqueViolation, sessions, walletAddresses } from "@repo/db";
import { CHAINS, familyOf, type AssetChain } from "@repo/validator";
import { env } from "@/config/dotenv";
import { writeAudit } from "@/modules/audit/audit.service";
import { grantIfProven } from "@/modules/manager-applications/applications.service";
import { linkInvitesIfProven } from "@/modules/members/members.service";
import { hasOpenOperation } from "@/modules/operations/investability.service";
import { walletBalance } from "@/modules/operations/operations.service";
import { heldUnitsOnChain } from "@/modules/portfolio/portfolio.service";
import { createSession, revokeSession } from "./sessions.service";
import { claimChallenge, rejectChallenge, type VerifyInput, type VerifyResult } from "./sign-in.service";
import { verifyEvmSignature, verifySolanaSignature } from "./signatures.service";
import { findAddressOwner } from "./wallets.service";

/** Rejections that are final for the challenge; any other failure releases the claim so the user can retry with the same signature. */
const FINAL = new Set(["SIGNATURE_INVALID", "CHAIN_NOT_LINKED", "VALIDATION_FAILED", "ADDRESS_ALREADY_LINKED"]);

export function assertChainEmpty(i: { openOperation: boolean; heldUnits: { symbol: string }[]; onchain: { symbol: string; amount: bigint }[] }): void {
  if (i.openOperation) throw createHttpError("Finish or cancel your current operation first.", { code: "OPERATION_IN_PROGRESS" });
  const left = [...new Set([...i.heldUnits.map((h) => h.symbol), ...i.onchain.filter((b) => b.amount > 0n).map((b) => b.symbol)])];
  if (left.length > 0) throw createHttpError(`Sell what you hold on this chain first: ${left.join(", ")}.`, { code: "CHAIN_NOT_EMPTY", details: { assets: left } });
}

export type ReassignInput = VerifyInput & { previousSignature?: string };

/** D-120: move one chain to a new address, only when the chain is empty. The new address signs; the session rotates. */
export async function reassignChain(input: ReassignInput): Promise<VerifyResult> {
  const auth = input.auth;
  if (!auth) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
  const { ch, claimId } = await claimChallenge(input.challengeId, ["reassign_chain"]);
  try {
    if (auth.sessionId !== ch.sessionId) throw createHttpError("This challenge belongs to another session", { code: "SIGNATURE_INVALID" });
    const chain = ch.chain as AssetChain;
    const request = { chain, address: ch.address, message: ch.message, signature: input.signature };
    const outcome = familyOf(chain) === "evm" ? await verifyEvmSignature(request) : familyOf(chain) === "solana" ? verifySolanaSignature(request) : { kind: "invalid" as const };
    if (outcome.kind === "invalid") throw createHttpError("Signature could not be verified", { code: "SIGNATURE_INVALID" });

    const [current] = await db.select({ id: walletAddresses.id, address: walletAddresses.address, walletId: investmentWallets.id }).from(walletAddresses)
      .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
      .where(and(eq(investmentWallets.userId, auth.userId), eq(investmentWallets.status, "active"), eq(walletAddresses.chain, chain), eq(walletAddresses.status, "active")));
    if (!current) throw createHttpError(`${CHAINS[chain].label} is not linked yet. Link a wallet for it instead.`, { code: "CHAIN_NOT_LINKED" });

    // Step-up: the chain's current address must sign the same message, so a stolen session alone cannot redirect the chain.
    const previous = input.previousSignature
      ? await (familyOf(chain) === "evm" ? verifyEvmSignature({ chain, address: current.address, message: ch.message, signature: input.previousSignature })
        : Promise.resolve(verifySolanaSignature({ address: current.address, message: ch.message, signature: input.previousSignature })))
      : { kind: "invalid" as const };
    if (previous.kind === "invalid") throw createHttpError("The wallet now linked to this chain must also sign.", { code: "SIGNATURE_INVALID" });

    // On-chain balances of every registered non-native asset on the chain, read outside any transaction (RPC). The ledger and open operations are re-checked inside, under the wallet lock.
    const deployments = await db.select({ symbol: instruments.symbol, address: instrumentDeployments.address }).from(instrumentDeployments)
      .innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId)).where(and(eq(instrumentDeployments.chain, chain), isNotNull(instrumentDeployments.address))); // native dust (gas drops) never blocks a move; native held through Bytesac is in the ledger
    // Fail closed: an unreadable balance is never treated as empty.
    const onchain = await Promise.all(deployments.map(async (d) => ({ symbol: d.symbol, amount: await walletBalance({ [chain]: current.address }, chain, d.address).catch((e: unknown) => {
      throw isHttpError(e) ? e : createHttpError("The chain is temporarily unavailable. Try again.", { code: "VERIFIER_UNAVAILABLE", cause: e });
    }) })));

    return await db.transaction(async (tx) => {
      await tx.select({ id: investmentWallets.id }).from(investmentWallets).where(eq(investmentWallets.id, current.walletId)).for("update");
      // Re-read under the lock: a concurrent move or disable must not be overwritten.
      const [still] = await tx.select({ id: walletAddresses.id }).from(walletAddresses)
        .where(and(eq(walletAddresses.id, current.id), eq(walletAddresses.status, "active")));
      if (!still) throw createHttpError("This chain changed while you were signing. Start again.", { code: "CHAIN_NOT_LINKED" });
      if (current.address === ch.address) throw createHttpError("That wallet already holds this chain.", { code: "VALIDATION_FAILED" });
      const holder = await findAddressOwner(tx, chain, ch.address);
      if (holder?.userId === auth.userId) throw createHttpError("This address was used for this chain before. Pick another wallet.", { code: "VALIDATION_FAILED" });
      if (holder) throw createHttpError("This address is linked to another account", { code: "ADDRESS_ALREADY_LINKED" });

      assertChainEmpty({ openOperation: await hasOpenOperation(tx, auth.userId), heldUnits: await heldUnitsOnChain(tx, auth.userId, chain), onchain });

      const consumed = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
        .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing"))).returning({ id: authChallenges.id });
      if (consumed.length !== 1) throw createHttpError("This sign-in request is already being verified.", { code: "CHALLENGE_IN_PROGRESS" });

      // One active row per wallet and chain, and a replaced row must point at its successor: step the old row aside, insert the new, then link them.
      await tx.update(walletAddresses).set({ status: "disabled", disabledAt: sql`now()`, disabledReason: "chain_reassigned" }).where(eq(walletAddresses.id, current.id));
      const [created] = await tx.insert(walletAddresses).values({
        investmentWalletId: current.walletId, chainFamily: familyOf(chain), chain, address: ch.address, verificationMethod: outcome.method,
        verifiedOnChain: chain, verificationChallengeId: ch.id, walletName: input.walletProvider ?? null,
        signableChains: input.signableChains?.filter((c) => c === chain) ?? null,
      }).returning({ id: walletAddresses.id });
      await tx.update(walletAddresses).set({ status: "replaced", replacedAt: sql`now()`, replacedByAddressId: created!.id }).where(eq(walletAddresses.id, current.id));
      await writeAudit(tx, {
        actorType: "user", actorUserId: auth.userId, action: "wallet.chain_reassigned", entityType: "investment_wallet", entityId: current.walletId,
        requestId: input.meta.requestId, sessionId: auth.sessionId, challengeId: ch.id, metadata: { chain, from: current.address, to: ch.address },
      });
      // The moved-to address is newly proven control, like an add_chain_account link: run the same manager-grant and invite hooks.
      const proof = { userId: auth.userId, chain, address: ch.address, method: outcome.method, requestId: input.meta.requestId };
      await grantIfProven(tx, proof);
      await linkInvitesIfProven(tx, proof);

      if (!(await revokeSession(tx, auth.sessionId, "rotated"))) throw createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
      const issued = await createSession(tx, { userId: auth.userId, client: auth.client, pepper: env.SESSION_TOKEN_PEPPER, meta: input.meta });
      await tx.update(sessions).set({ replacedBySessionId: issued.id }).where(eq(sessions.id, auth.sessionId));
      await writeAudit(tx, {
        actorType: "user", actorUserId: auth.userId, action: "session.rotated", entityType: "session", entityId: issued.id,
        requestId: input.meta.requestId, sessionId: issued.id, metadata: { previousSessionId: auth.sessionId },
      });
      return { userId: auth.userId, isNewUser: false, issued };
    });
  } catch (err) {
    const clash = isUniqueViolation(err, "wallet_addresses_chain_address_key"); // lost a race for the new address
    const reason = clash ? "ADDRESS_ALREADY_LINKED" : isHttpError(err) && FINAL.has(err.code) ? err.code : null;
    if (reason) await rejectChallenge(ch, claimId, reason, input);
    else await db.update(authChallenges).set({ status: "pending", claimId: null, leaseExpiresAt: null }).where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
    throw clash ? createHttpError("This address is linked to another account", { code: "ADDRESS_ALREADY_LINKED" }) : err;
  }
}
