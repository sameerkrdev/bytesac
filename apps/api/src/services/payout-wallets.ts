import createHttpError from "http-errors";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authChallenges, db, organizationEvents, organizationPayoutWallets } from "@repo/db";
import type { ChallengeResponse, OrganizationDetail, OrganizationStatus } from "@repo/validator";
import { writeAudit } from "./audit";
import { requirePermission } from "./members";
import { getOrganizationForMember, notifyOwner, type OwnerCtx } from "./organizations";
import { claimChallenge, issueChallenge, rejectChallenge } from "./sign-in";
import { verifySolanaSignature } from "./signatures";
import { canonicalizeAddress } from "./wallets";

/** The wallet is not touched while the organization is under review. */
const WALLET_EDITABLE: readonly OrganizationStatus[] = ["DRAFT", "CHANGES_REQUIRED", "VERIFIED"];
const inReview = () => createHttpError("The payout wallet can't be changed while the organization is in review.", { code: "INVALID_TRANSITION" });
const signatureInvalid = () => createHttpError("Signature could not be verified", { code: "SIGNATURE_INVALID" });

/** Records the typed address as UNVERIFIED (an identifier only). An earlier not-yet-proven row is revoked; a pending replacement blocks a new entry. */
export async function enterPayoutWallet(ctx: OwnerCtx, orgId: string, rawAddress: string): Promise<OrganizationDetail> {
  const address = canonicalizeAddress("solana", rawAddress);
  await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, orgId, "payout.manage", true);
    if (!WALLET_EDITABLE.includes(org.status)) throw inReview();
    const [pending] = await tx.select({ id: organizationPayoutWallets.id }).from(organizationPayoutWallets)
      .where(and(eq(organizationPayoutWallets.organizationId, orgId), eq(organizationPayoutWallets.status, "REPLACEMENT_PENDING")));
    if (pending) throw createHttpError("A payout wallet change is already awaiting review.", { code: "INVALID_TRANSITION" });
    await tx.update(organizationPayoutWallets).set({ status: "REVOKED", deactivatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(organizationPayoutWallets.organizationId, orgId), inArray(organizationPayoutWallets.status, ["UNVERIFIED", "VERIFYING"])));
    const [w] = await tx.insert(organizationPayoutWallets).values({ organizationId: orgId, address, requestedByUserId: ctx.userId }).returning({ id: organizationPayoutWallets.id });
    await tx.insert(organizationEvents).values({ organizationId: orgId, actorType: "owner", actorUserId: ctx.userId, kind: "payout_wallet_changed", payoutWalletId: w!.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "payout_wallet.entered", entityType: "organization", entityId: orgId,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { walletId: w!.id, address },
    });
  });
  return getOrganizationForMember(ctx, orgId);
}

/** Issues the payout challenge for the not-yet-proven wallet, bound to the organization, address and this session. */
export async function issuePayoutChallenge(ctx: OwnerCtx, orgId: string): Promise<ChallengeResponse> {
  const { org } = await requirePermission(db, ctx.userId, orgId, "payout.manage");
  if (!WALLET_EDITABLE.includes(org.status)) throw inReview();
  const [w] = await db.select().from(organizationPayoutWallets)
    .where(and(eq(organizationPayoutWallets.organizationId, orgId), inArray(organizationPayoutWallets.status, ["UNVERIFIED", "VERIFYING"])));
  if (!w) throw createHttpError("Enter a payout wallet address first.", { code: "INVALID_TRANSITION" });
  const challenge = await issueChallenge({
    purpose: "payout_wallet", chain: "solana", rawAddress: w.address, sessionId: ctx.sessionId, organizationId: orgId, meta: ctx.meta,
  });
  const marked = await db.update(organizationPayoutWallets).set({ status: "VERIFYING", updatedAt: sql`now()` })
    .where(and(eq(organizationPayoutWallets.id, w.id), inArray(organizationPayoutWallets.status, ["UNVERIFIED", "VERIFYING"]))).returning({ id: organizationPayoutWallets.id });
  if (marked.length === 0) throw createHttpError("The payout wallet changed. Start again.", { code: "INVALID_TRANSITION" });
  return challenge;
}

/**
 * Proves control of the payout wallet. Never touches sessions or wallet_addresses. The proof activates the wallet, or, on a verified
 * organization that already has an active wallet, becomes a REPLACEMENT_PENDING request that ops must approve.
 */
export async function verifyPayoutWallet(ctx: OwnerCtx, orgId: string, i: { challengeId: string; signature: string }): Promise<OrganizationDetail> {
  await requirePermission(db, ctx.userId, orgId, "payout.manage");
  const { ch, claimId } = await claimChallenge(i.challengeId, ["payout_wallet"]);
  const reject = async () => {
    await rejectChallenge(ch, claimId, "SIGNATURE_INVALID", { auth: ctx, meta: ctx.meta });
    return signatureInvalid();
  };
  if (ch.organizationId !== orgId || ch.sessionId !== ctx.sessionId) throw await reject();
  if (verifySolanaSignature({ address: ch.address, message: ch.message, signature: i.signature }).kind === "invalid") throw await reject();

  const replacementWalletId = await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, orgId, "payout.manage", true);
    if (!WALLET_EDITABLE.includes(org.status)) throw inReview();
    const consumed = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, ch.id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing"))).returning({ id: authChallenges.id });
    if (consumed.length !== 1) throw createHttpError("This payout wallet request is already being verified.", { code: "CHALLENGE_IN_PROGRESS" });
    const [w] = await tx.select().from(organizationPayoutWallets).where(and(
      eq(organizationPayoutWallets.organizationId, orgId), eq(organizationPayoutWallets.address, ch.address), eq(organizationPayoutWallets.status, "VERIFYING"),
    )).for("update");
    if (!w) throw createHttpError("Start the payout wallet check again.", { code: "INVALID_TRANSITION" });
    const [active] = await tx.select().from(organizationPayoutWallets)
      .where(and(eq(organizationPayoutWallets.organizationId, orgId), eq(organizationPayoutWallets.status, "VERIFIED"))).for("update");
    const proof = { verificationChallengeId: ch.id, verificationSignature: i.signature };
    const replacement = active !== undefined && org.status === "VERIFIED";
    if (replacement) {
      await tx.update(organizationPayoutWallets).set({ status: "REPLACEMENT_PENDING", ...proof, verifiedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, w.id));
    } else {
      if (active) await tx.update(organizationPayoutWallets).set({ status: "REVOKED", deactivatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, active.id));
      await tx.update(organizationPayoutWallets).set({ status: "VERIFIED", ...proof, verifiedAt: sql`now()`, activatedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, w.id));
    }
    await tx.insert(organizationEvents).values({ organizationId: orgId, actorType: "owner", actorUserId: ctx.userId, kind: "payout_wallet_changed", payoutWalletId: w.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: replacement ? "payout_wallet.replacement_requested" : "payout_wallet.verified", entityType: "organization",
      entityId: orgId, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, challengeId: ch.id, metadata: { walletId: w.id, address: w.address },
    });
    return replacement ? w.id : null;
  });
  if (replacementWalletId) await notifyOwner(orgId, "payout_replacement_requested", {}, `payout-replacement-requested/${replacementWalletId}`);
  return getOrganizationForMember(ctx, orgId);
}
