import { Router, type Request } from "express";
import {
  applicationNoteRequestSchema, decideMemberVerificationRequestSchema, grantRoleRequestSchema, listApplicationsQuerySchema, listMemberReviewQuerySchema, listOrganizationsQuerySchema,
  organizationNoteRequestSchema, payoutWalletDecisionRequestSchema, transferOwnershipRequestSchema, transitionApplicationRequestSchema, transitionOrganizationRequestSchema,
  versionDecisionRequestSchema, z,
  type ApplicationNoteRequest, type DecideMemberVerificationRequest, type GrantRoleRequest, type TransferOwnershipRequest, type OrganizationNoteRequest, type PayoutWalletDecisionRequest, type PlatformRolesResponse,
  type TransitionApplicationRequest, type TransitionOrganizationRequest, type VersionDecisionRequest,
} from "@repo/validator";
import { requireRole, requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  decideMemberVerification, getMemberForReview, listMembersForReview, memberDocumentDownloadUrl, transferOwnership,
} from "../services/member-verifications";
import { addApplicationNote, getApplicationDetail, listApplications, transitionApplication } from "../services/applications";
import {
  addOrganizationNote, decidePayoutWallet, decideVersion, documentDownloadUrl, getOrganizationForReview, listOrganizationsForReview, transitionOrganization,
} from "../services/organization-review";
import { grantRole, listRoles, revokeRole } from "../services/platform-roles";

const idParam = z.object({ id: z.uuid() });
const midParam = z.object({ mid: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });
const actor = (req: Request) => ({ userId: req.auth!.userId, requestId: req.ctx.requestId });

export const opsRouter = Router();
opsRouter.use(requireSession, async (req, _res, next) => {
  await consume(limits.opsUser, req.auth!.userId);
  next();
});

opsRouter.get("/applications", requireRole("ops_reviewer"), async (req, res) => {
  res.json(await listApplications(listApplicationsQuerySchema.parse(req.query)));
});

opsRouter.get("/applications/:id", requireRole("ops_reviewer"), validate({ params: idParam }), async (req, res) => {
  res.json(await getApplicationDetail(req.params.id as string));
});

opsRouter.post("/applications/:id/transition", requireRole("ops_reviewer"), validate({ params: idParam, body: transitionApplicationRequestSchema }), async (req, res) => {
  res.json(await transitionApplication(ctx(req), req.params.id as string, req.body as TransitionApplicationRequest));
});

opsRouter.post("/applications/:id/notes", requireRole("ops_reviewer"), validate({ params: idParam, body: applicationNoteRequestSchema }), async (req, res) => {
  res.status(201).json(await addApplicationNote(ctx(req), req.params.id as string, (req.body as ApplicationNoteRequest).internalNote));
});

opsRouter.get("/organizations", requireRole("ops_reviewer"), async (req, res) => {
  res.json(await listOrganizationsForReview(listOrganizationsQuerySchema.parse(req.query)));
});

opsRouter.get("/organizations/:id", requireRole("ops_reviewer"), validate({ params: idParam }), async (req, res) => {
  res.json(await getOrganizationForReview(req.params.id as string));
});

opsRouter.post("/organizations/:id/transition", requireRole("ops_reviewer"), validate({ params: idParam, body: transitionOrganizationRequestSchema }), async (req, res) => {
  res.json(await transitionOrganization(ctx(req), req.params.id as string, req.body as TransitionOrganizationRequest));
});

opsRouter.post("/organizations/:id/versions/:versionId/decision", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), versionId: z.uuid() }), body: versionDecisionRequestSchema }), async (req, res) => {
  res.json(await decideVersion(ctx(req), req.params.id as string, req.params.versionId as string, req.body as VersionDecisionRequest));
});

opsRouter.post("/organizations/:id/payout-wallets/:walletId/decision", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), walletId: z.uuid() }), body: payoutWalletDecisionRequestSchema }), async (req, res) => {
  res.json(await decidePayoutWallet(ctx(req), req.params.id as string, req.params.walletId as string, req.body as PayoutWalletDecisionRequest));
});

opsRouter.post("/organizations/:id/notes", requireRole("ops_reviewer"), validate({ params: idParam, body: organizationNoteRequestSchema }), async (req, res) => {
  res.status(201).json(await addOrganizationNote(ctx(req), req.params.id as string, (req.body as OrganizationNoteRequest).internalNote));
});

opsRouter.get("/organizations/:id/documents/:docId/download", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), docId: z.uuid() }) }), async (req, res) => {
  res.set("Cache-Control", "no-store").redirect(302, await documentDownloadUrl(ctx(req), req.params.id as string, req.params.docId as string));
});

opsRouter.get("/members", requireRole("ops_reviewer"), async (req, res) => {
  res.json(await listMembersForReview(listMemberReviewQuerySchema.parse(req.query)));
});

opsRouter.get("/members/:mid", requireRole("ops_reviewer"), validate({ params: midParam }), async (req, res) => {
  res.json(await getMemberForReview(req.params.mid as string));
});

opsRouter.post("/members/:mid/decision", requireRole("ops_reviewer"), validate({ params: midParam, body: decideMemberVerificationRequestSchema }), async (req, res) => {
  res.json(await decideMemberVerification(ctx(req), req.params.mid as string, req.body as DecideMemberVerificationRequest));
});

opsRouter.get("/members/:mid/documents/:docId/download", requireRole("ops_reviewer"), validate({ params: z.object({ mid: z.uuid(), docId: z.uuid() }) }), async (req, res) => {
  res.set("Cache-Control", "no-store").redirect(302, await memberDocumentDownloadUrl(ctx(req), req.params.mid as string, req.params.docId as string));
});

opsRouter.post("/organizations/:id/transfer-ownership", requireRole("ops_admin"), validate({ params: idParam, body: transferOwnershipRequestSchema }), async (req, res) => {
  await transferOwnership(ctx(req), req.params.id as string, req.body as TransferOwnershipRequest);
  res.status(204).end();
});

opsRouter.get("/roles", requireRole("ops_admin"), async (_req, res) => {
  const body: PlatformRolesResponse = { roles: await listRoles() };
  res.json(body);
});

opsRouter.post("/roles", requireRole("ops_admin"), validate({ body: grantRoleRequestSchema }), async (req, res) => {
  const { userId, role } = req.body as GrantRoleRequest;
  res.status(201).json(await grantRole(actor(req), userId, role));
});

opsRouter.delete("/roles/:id", requireRole("ops_admin"), validate({ params: idParam }), async (req, res) => {
  await revokeRole(actor(req), req.params.id as string);
  res.status(204).end();
});
