import { Router, type Request } from "express";
import {
  changeRoleRequestSchema, earningsQuerySchema, createBasketRequestSchema, createOrganizationRequestSchema, enterPayoutWalletRequestSchema, inviteMemberRequestSchema, listBasketsQuerySchema, presignDocumentRequestSchema, updateDraftRequestSchema,
  verifyPayoutWalletRequestSchema, z,
  type ChangeRoleRequest, type CreateBasketRequest, type CreateOrganizationRequest, type EnterPayoutWalletRequest, type InviteMemberRequest, type PresignDocumentRequest, type UpdateDraftRequest,
  type VerifyPayoutWalletRequest,
} from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { createBasket, listOrgBaskets } from "../services/baskets";
import { getEarnings, getEarningsCsv } from "../services/fees";
import { cancelInvite, changeRole, decideRemoval, inviteMember, listMembers, removeMember } from "../services/members";
import {
  confirmDocument, createChangeRequest, createOrganization, getOrganizationForMember, listMyOrganizations, presignDocument, submitChangeRequest, submitOrganization,
  unlinkDocument, updateDraft,
} from "../services/organizations";
import { enterPayoutWallet, issuePayoutChallenge, verifyPayoutWallet } from "../services/payout-wallets";

const idParam = z.object({ id: z.uuid() });
const docParams = z.object({ id: z.uuid(), docId: z.uuid() });
const memberParams = z.object({ id: z.uuid(), mid: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const organizationsRouter = Router();
organizationsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

organizationsRouter.post("/", validate({ body: createOrganizationRequestSchema }), async (req, res) => {
  res.status(201).json(await createOrganization(ctx(req), req.body as CreateOrganizationRequest));
});

organizationsRouter.get("/mine", async (req, res) => {
  res.json(await listMyOrganizations(req.auth!.userId));
});

organizationsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json(await getOrganizationForMember(ctx(req), req.params.id as string));
});

organizationsRouter.patch("/:id/draft", validate({ params: idParam, body: updateDraftRequestSchema }), async (req, res) => {
  res.json(await updateDraft(ctx(req), req.params.id as string, req.body as UpdateDraftRequest));
});

organizationsRouter.post("/:id/documents", validate({ params: idParam, body: presignDocumentRequestSchema }), async (req, res) => {
  res.status(201).json(await presignDocument(ctx(req), req.params.id as string, req.body as PresignDocumentRequest));
});

organizationsRouter.post("/:id/documents/:docId/confirm", validate({ params: docParams }), async (req, res) => {
  res.json(await confirmDocument(ctx(req), req.params.id as string, req.params.docId as string));
});

organizationsRouter.delete("/:id/draft/documents/:docId", validate({ params: docParams }), async (req, res) => {
  res.json(await unlinkDocument(ctx(req), req.params.id as string, req.params.docId as string));
});

organizationsRouter.post("/:id/payout-wallet", validate({ params: idParam, body: enterPayoutWalletRequestSchema }), async (req, res) => {
  res.status(201).json(await enterPayoutWallet(ctx(req), req.params.id as string, (req.body as EnterPayoutWalletRequest).address));
});

organizationsRouter.post("/:id/payout-wallet/challenge", validate({ params: idParam }), async (req, res) => {
  res.json(await issuePayoutChallenge(ctx(req), req.params.id as string));
});

organizationsRouter.post("/:id/payout-wallet/verify", validate({ params: idParam, body: verifyPayoutWalletRequestSchema }), async (req, res) => {
  res.json(await verifyPayoutWallet(ctx(req), req.params.id as string, req.body as VerifyPayoutWalletRequest));
});

organizationsRouter.post("/:id/submit", validate({ params: idParam }), async (req, res) => {
  res.json(await submitOrganization(ctx(req), req.params.id as string));
});

organizationsRouter.post("/:id/change-request", validate({ params: idParam }), async (req, res) => {
  res.status(201).json(await createChangeRequest(ctx(req), req.params.id as string));
});

organizationsRouter.get("/:id/members", validate({ params: idParam }), async (req, res) => {
  res.json(await listMembers(ctx(req), req.params.id as string));
});

organizationsRouter.post("/:id/members/invitations", validate({ params: idParam, body: inviteMemberRequestSchema }), async (req, res) => {
  res.status(201).json(await inviteMember(ctx(req), req.params.id as string, req.body as InviteMemberRequest));
});

organizationsRouter.post("/:id/members/:mid/cancel", validate({ params: memberParams }), async (req, res) => {
  res.json(await cancelInvite(ctx(req), req.params.id as string, req.params.mid as string));
});

organizationsRouter.post("/:id/members/:mid/role", validate({ params: memberParams, body: changeRoleRequestSchema }), async (req, res) => {
  res.json(await changeRole(ctx(req), req.params.id as string, req.params.mid as string, req.body as ChangeRoleRequest));
});

organizationsRouter.post("/:id/members/:mid/remove", validate({ params: memberParams }), async (req, res) => {
  res.json(await removeMember(ctx(req), req.params.id as string, req.params.mid as string));
});

organizationsRouter.post("/:id/members/:mid/removal/confirm", validate({ params: memberParams }), async (req, res) => {
  res.json(await decideRemoval(ctx(req), req.params.id as string, req.params.mid as string, "confirm"));
});

organizationsRouter.post("/:id/members/:mid/removal/cancel", validate({ params: memberParams }), async (req, res) => {
  res.json(await decideRemoval(ctx(req), req.params.id as string, req.params.mid as string, "cancel"));
});

organizationsRouter.post("/:id/change-request/submit", validate({ params: idParam }), async (req, res) => {
  res.json(await submitChangeRequest(ctx(req), req.params.id as string));
});

organizationsRouter.post("/:id/baskets", validate({ params: idParam, body: createBasketRequestSchema }), async (req, res) => {
  res.status(201).json(await createBasket(ctx(req), req.params.id as string, req.body as CreateBasketRequest));
});

organizationsRouter.get("/:id/baskets", validate({ params: idParam }), async (req, res) => {
  res.json(await listOrgBaskets(ctx(req), req.params.id as string, listBasketsQuerySchema.parse(req.query)));
});

/** Settled manager fees (Owner and Admin: `earnings.read`); `format=csv` downloads one row per settled fee. */
organizationsRouter.get("/:id/earnings", validate({ params: idParam }), async (req, res) => {
  const q = earningsQuerySchema.parse(req.query);
  if (q.format === "csv") res.type("text/csv").attachment("earnings.csv").send(await getEarningsCsv(req.auth!.userId, req.params.id as string, q));
  else res.json(await getEarnings(req.auth!.userId, req.params.id as string, q));
});
