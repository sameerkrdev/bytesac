import { Router, type Request } from "express";
import {
  membershipProfileRequestSchema, presignDocumentRequestSchema, updateMemberVerificationRequestSchema, z,
  type MembershipProfileRequest, type PresignDocumentRequest, type UpdateMemberVerificationRequest,
} from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
  confirmMemberDocument, getMemberVerification, presignMemberDocument, submitMemberVerification, unlinkMemberDocument, updateMemberVerification,
} from "@/services/member-verifications";
import { acceptInvitation, declineInvitation, expireInvites, leaveOrganization, myMembershipView, updateMembershipProfile } from "@/services/members";
import { db, organizationMemberships } from "@repo/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";

const midParam = z.object({ mid: z.uuid() });
const docParams = z.object({ mid: z.uuid(), docId: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

/** The caller's own membership: invitations, leaving, the public name and the member's own verification. */
export const membershipsRouter = Router();
membershipsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

membershipsRouter.get("/:mid", validate({ params: midParam }), async (req, res) => {
  await db.transaction((tx) => expireInvites(tx, and(eq(organizationMemberships.id, req.params.mid as string), eq(organizationMemberships.userId, req.auth!.userId))!, req.ctx.requestId));
  const [m] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, req.params.mid as string), eq(organizationMemberships.userId, req.auth!.userId)));
  if (!m) throw createHttpError(404, "Membership not found", { code: "NOT_FOUND" });
  res.json(myMembershipView(m));
});

membershipsRouter.post("/:mid/accept", validate({ params: midParam }), async (req, res) => {
  res.json(await acceptInvitation(ctx(req), req.params.mid as string));
});

membershipsRouter.post("/:mid/decline", validate({ params: midParam }), async (req, res) => {
  res.json(await declineInvitation(ctx(req), req.params.mid as string));
});

membershipsRouter.post("/:mid/leave", validate({ params: midParam }), async (req, res) => {
  res.json(await leaveOrganization(ctx(req), req.params.mid as string));
});

membershipsRouter.patch("/:mid/profile", validate({ params: midParam, body: membershipProfileRequestSchema }), async (req, res) => {
  res.json(await updateMembershipProfile(ctx(req), req.params.mid as string, req.body as MembershipProfileRequest));
});

membershipsRouter.get("/:mid/verification", validate({ params: midParam }), async (req, res) => {
  res.json(await getMemberVerification(ctx(req), req.params.mid as string));
});

membershipsRouter.patch("/:mid/verification", validate({ params: midParam, body: updateMemberVerificationRequestSchema }), async (req, res) => {
  res.json(await updateMemberVerification(ctx(req), req.params.mid as string, req.body as UpdateMemberVerificationRequest));
});

membershipsRouter.post("/:mid/verification/documents", validate({ params: midParam, body: presignDocumentRequestSchema }), async (req, res) => {
  res.status(201).json(await presignMemberDocument(ctx(req), req.params.mid as string, req.body as PresignDocumentRequest));
});

membershipsRouter.post("/:mid/verification/documents/:docId/confirm", validate({ params: docParams }), async (req, res) => {
  res.json(await confirmMemberDocument(ctx(req), req.params.mid as string, req.params.docId as string));
});

membershipsRouter.delete("/:mid/verification/documents/:docId", validate({ params: docParams }), async (req, res) => {
  res.json(await unlinkMemberDocument(ctx(req), req.params.mid as string, req.params.docId as string));
});

membershipsRouter.post("/:mid/verification/submit", validate({ params: midParam }), async (req, res) => {
  res.json(await submitMemberVerification(ctx(req), req.params.mid as string));
});
