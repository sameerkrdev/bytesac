import { and, eq, isNull, ne } from "drizzle-orm";
import createHttpError from "http-errors";
import { Router } from "express";
import { contacts, db, investmentWallets, sessions, userPermissions, users } from "@repo/db";
import {
  bitcoinChallengeRequestSchema, bitcoinVerifySchema, eligibilityDeclarationInputSchema, familyOf, listNotificationsQuerySchema, managerProfileRequestSchema, markReadSchema, pushTokenSchema, z,
  type BitcoinChallengeRequest, type BitcoinVerify, type EligibilityDeclarationInput, type ManagerProfileRequest, type MeResponse, type SessionsResponse,
} from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { respondVerified } from "./auth";
import { issueChallenge, verifyChallenge } from "../services/sign-in";
import { writeAudit } from "../services/audit";
import { contactView } from "../services/contacts";
import { currentDeclaration, declare } from "../services/eligibility";
import { activeRoles } from "../services/platform-roles";
import { listMyInvitations } from "../services/members";
import { listNotifications, markRead, registerPushToken, revokePushToken } from "../services/notifications";
import { getOwnProfile, saveOwnProfile, setOwnProfilePublished } from "../services/manager-profiles";
import { listMyOrganizations } from "../services/organizations";
import { listActiveSessions, revokeSession } from "../services/sessions";
import { bip322ToSignPsbt } from "../providers/bitcoin";
import { addressesForWallet, canonicalBitcoinAddress } from "../services/wallets";

export const meRouter = Router();
meRouter.use(requireSession);

meRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const [wallet] = await db.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
  if (!user || !wallet) throw createHttpError("This account is not active", { code: "USER_NOT_ACTIVE" });
  const addresses = await addressesForWallet(db, wallet.id);
  const current = await db.select().from(contacts).where(and(eq(contacts.userId, userId), ne(contacts.status, "replaced")));
  const body: MeResponse = {
    user: { id: user.id, status: user.status, createdAt: user.createdAt.toISOString() },
    wallet: {
      id: wallet.id,
      walletProvider: wallet.walletProvider,
      addresses: addresses.map((a) => ({
        chain: a.chain, chainFamily: familyOf(a.chain), address: a.address, status: a.status,
        verificationMethod: a.verificationMethod, verifiedAt: a.verifiedAt.toISOString(),
      })),
    },
    contacts: current.map(contactView),
    permissions: (await db.select({ permission: userPermissions.permission }).from(userPermissions).where(and(eq(userPermissions.userId, userId), isNull(userPermissions.revokedAt)))).map((p) => p.permission),
    platformRoles: await activeRoles(db, userId),
    organizations: (await listMyOrganizations(userId)).organizations.map((o) => ({ id: o.id, displayName: o.displayName, role: o.role, status: o.status, membershipId: o.membershipId, membershipStatus: o.membershipStatus })),
  };
  res.json(body);
});

/** Spec 11: the self-declared country and investor status that tokenized-asset eligibility rests on (append-only; the latest row is current for 365 days). */
meRouter.get("/eligibility", async (req, res) => {
  res.json(await currentDeclaration(db, req.auth!.userId));
});

meRouter.post("/eligibility", validate({ body: eligibilityDeclarationInputSchema }), async (req, res) => {
  await consume(limits.eligibilityUser, req.auth!.userId);
  res.status(201).json(await declare({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx }, req.body as EligibilityDeclarationInput));
});

/** Bitcoin is link-only (add-chain): a BIP-322 or BIP-137 proof over the challenge message, with the Spec 1 rules (one address per family, not linked elsewhere, session rotation, audit). */
meRouter.post("/chain-accounts/bitcoin/challenge", validate({ body: bitcoinChallengeRequestSchema }), async (req, res) => {
  const { address } = req.body as BitcoinChallengeRequest;
  await consume(limits.bitcoinLinkUser, req.auth!.userId);
  const challenge = await issueChallenge({ purpose: "add_chain_account", chain: "bitcoin", rawAddress: address, sessionId: req.auth!.sessionId, meta: req.ctx });
  res.json({ ...challenge, toSignPsbt: bip322ToSignPsbt(canonicalBitcoinAddress(address), challenge.message) });
});

meRouter.post("/chain-accounts/bitcoin/verify", validate({ body: bitcoinVerifySchema }), async (req, res) => {
  const body = req.body as BitcoinVerify;
  await consume(limits.bitcoinLinkUser, req.auth!.userId);
  respondVerified(res, await verifyChallenge({
    challengeId: body.challengeId, signature: body.signature, client: req.auth!.client, auth: req.auth, meta: req.ctx,
    bitcoin: { method: body.method, address: canonicalBitcoinAddress(body.address) },
  }));
});

meRouter.get("/invitations", async (req, res) => {
  res.json(await listMyInvitations({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx }));
});

meRouter.get("/sessions", async (req, res) => {
  const rows = await listActiveSessions(db, req.auth!.userId);
  const body: SessionsResponse = {
    sessions: rows.map((s) => ({
      id: s.id, client: s.client, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
      userAgent: s.userAgent, ipPrefix: s.ipPrefix, current: s.id === req.auth!.sessionId,
    })),
  };
  res.json(body);
});

meRouter.delete("/sessions/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  const id = (req.params.id as string);
  const [owned] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, req.auth!.userId)));
  if (!owned) throw createHttpError("Session not found", { code: "NOT_FOUND" });
  await db.transaction(async (tx) => {
    if (await revokeSession(tx, id, "user_revoked")) {
      await writeAudit(tx, { actorType: "user", actorUserId: req.auth!.userId, action: "session.revoked", entityType: "session", entityId: id, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { reason: "user_revoked" } });
    }
  });
  res.status(204).end();
});

meRouter.get("/notifications", async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  res.json(await listNotifications(req.auth!.userId, listNotificationsQuerySchema.parse(req.query)));
});

meRouter.post("/notifications/read", validate({ body: markReadSchema }), async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await markRead(req.auth!.userId, req.body as z.infer<typeof markReadSchema>);
  res.status(204).end();
});

meRouter.post("/push-tokens", validate({ body: pushTokenSchema }), async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await registerPushToken(req.auth!.userId, req.body as z.infer<typeof pushTokenSchema>);
  res.status(204).end();
});

meRouter.post("/push-tokens/revoke", validate({ body: pushTokenSchema.pick({ token: true }) }), async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await revokePushToken(req.auth!.userId, (req.body as { token: string }).token);
  res.status(204).end();
});

meRouter.get("/manager-profile", async (req, res) => {
  res.json(await getOwnProfile(req.auth!.userId));
});

meRouter.put("/manager-profile", validate({ body: managerProfileRequestSchema }), async (req, res) => {
  res.json(await saveOwnProfile(req.auth!.userId, req.body as ManagerProfileRequest));
});

for (const action of ["publish", "unpublish"] as const) {
  meRouter.post(`/manager-profile/${action}`, async (req, res) => {
    res.json(await setOwnProfilePublished({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, requestId: req.ctx.requestId }, action === "publish"));
  });
}
