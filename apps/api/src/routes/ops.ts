import { Router, type Request } from "express";
import {
  assetDecisionRequestSchema, assetProviderRequestSchema, createDeploymentRequestSchema, createInstrumentRequestSchema, createRouteRequestSchema, createRuleRequestSchema, issuerRequestSchema, navEntryRequestSchema,
  opsAssetListQuerySchema, priceKindSchema, putPriceReferenceRequestSchema, updateAssetProviderRequestSchema, updateDeploymentRequestSchema, updateInstrumentRequestSchema, updateIssuerRequestSchema,
  updateRouteRequestSchema, updateRuleRequestSchema,
  type AssetDecisionRequest, type AssetProviderRequest, type CreateDeploymentRequest, type CreateInstrumentRequest, type CreateRouteRequest, type CreateRuleRequest, type IssuerRequest, type NavEntryRequest,
  type PutPriceReferenceRequest, type UpdateAssetProviderRequest, type UpdateDeploymentRequest, type UpdateInstrumentRequest, type UpdateIssuerRequest, type UpdateRouteRequest, type UpdateRuleRequest,
  basketApprovalRequestSchema, basketReasonRequestSchema, basketReviewDecisionRequestSchema, createDisclosureTemplateRequestSchema, listOpsBasketsQuerySchema,
  applicationNoteRequestSchema, decideMemberVerificationRequestSchema, grantRoleRequestSchema, listApplicationsQuerySchema, listMemberReviewQuerySchema, listOrganizationsQuerySchema,
  organizationNoteRequestSchema, payoutWalletDecisionRequestSchema, transferOwnershipRequestSchema, transitionApplicationRequestSchema, transitionOrganizationRequestSchema,
  versionDecisionRequestSchema, z,
  createAssetTagRequestSchema, hideManagerProfileRequestSchema, listOpsManagerProfilesQuerySchema, type CreateAssetTagRequest, type HideManagerProfileRequest,
  type BasketApprovalRequest, type BasketReasonRequest, type BasketReviewDecisionRequest, type CreateDisclosureTemplateRequest,
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
import {
  createAssetProvider, createAssetTag, listAssetTags, retireAssetTag, createDeployment, createInstrument, createIssuer, createRoute, createRule, getAssetForOps, listAssetProviders, listAssetsForOps, listIssuers, putPriceReference,
  recordNav, updateAssetProvider, updateDeployment, updateInstrument, updateIssuer, updateRoute, updateRule, verifyDeployment,
} from "../services/assets";
import { hideProfile, listProfilesForOps, unhideProfile } from "../services/manager-profiles";
import { decideInstrument, submitInstrument, transitionAssetItem, transitionInstrument } from "../services/asset-review";
import {
  createDisclosureTemplate, decideLead, decideRetirement, decideVersion as decideBasketVersion, getBasketForOps, listBasketsForOps, listDisclosureTemplates, platformPause, platformResume, platformRetire,
  retireDisclosureTemplate,
} from "../services/basket-review";

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
  res.json(await getMemberForReview(ctx(req), req.params.mid as string));
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

const reviewer = requireRole("ops_reviewer");
const didParam = z.object({ id: z.uuid(), did: z.uuid() });
const ridParam = z.object({ id: z.uuid(), rid: z.uuid() });
const ruleParam = z.object({ id: z.uuid(), ruleId: z.uuid() });

opsRouter.get("/assets", reviewer, async (req, res) => {
  res.json(await listAssetsForOps(opsAssetListQuerySchema.parse(req.query)));
});

opsRouter.post("/assets", reviewer, validate({ body: createInstrumentRequestSchema }), async (req, res) => {
  res.status(201).json(await createInstrument(ctx(req), req.body as CreateInstrumentRequest));
});

opsRouter.get("/assets/:id", reviewer, validate({ params: idParam }), async (req, res) => {
  res.json(await getAssetForOps(req.params.id as string));
});

opsRouter.patch("/assets/:id", reviewer, validate({ params: idParam, body: updateInstrumentRequestSchema }), async (req, res) => {
  res.json(await updateInstrument(ctx(req), req.params.id as string, req.body as UpdateInstrumentRequest));
});

opsRouter.post("/assets/:id/deployments", reviewer, validate({ params: idParam, body: createDeploymentRequestSchema }), async (req, res) => {
  res.status(201).json(await createDeployment(ctx(req), req.params.id as string, req.body as CreateDeploymentRequest));
});

opsRouter.patch("/assets/:id/deployments/:did", reviewer, validate({ params: didParam, body: updateDeploymentRequestSchema }), async (req, res) => {
  res.json(await updateDeployment(ctx(req), req.params.id as string, req.params.did as string, req.body as UpdateDeploymentRequest));
});

opsRouter.post("/assets/:id/deployments/:did/verify", reviewer, validate({ params: didParam }), async (req, res) => {
  res.json(await verifyDeployment(ctx(req), req.params.id as string, req.params.did as string));
});

opsRouter.post("/assets/:id/routes", reviewer, validate({ params: idParam, body: createRouteRequestSchema }), async (req, res) => {
  res.status(201).json(await createRoute(ctx(req), req.params.id as string, req.body as CreateRouteRequest));
});

opsRouter.patch("/assets/:id/routes/:rid", reviewer, validate({ params: ridParam, body: updateRouteRequestSchema }), async (req, res) => {
  res.json(await updateRoute(ctx(req), req.params.id as string, req.params.rid as string, req.body as UpdateRouteRequest));
});

opsRouter.post("/assets/:id/rules", reviewer, validate({ params: idParam, body: createRuleRequestSchema }), async (req, res) => {
  res.status(201).json(await createRule(ctx(req), req.params.id as string, req.body as CreateRuleRequest));
});

opsRouter.patch("/assets/:id/rules/:ruleId", reviewer, validate({ params: ruleParam, body: updateRuleRequestSchema }), async (req, res) => {
  res.json(await updateRule(ctx(req), req.params.id as string, req.params.ruleId as string, req.body as UpdateRuleRequest));
});

opsRouter.put("/assets/:id/price-references/:kind", reviewer, validate({ params: z.object({ id: z.uuid(), kind: priceKindSchema }), body: putPriceReferenceRequestSchema }), async (req, res) => {
  res.json(await putPriceReference(ctx(req), req.params.id as string, req.params.kind as "market" | "nav", req.body as PutPriceReferenceRequest));
});

opsRouter.post("/assets/:id/nav", reviewer, validate({ params: idParam, body: navEntryRequestSchema }), async (req, res) => {
  res.status(201).json(await recordNav(ctx(req), req.params.id as string, req.body as NavEntryRequest));
});

opsRouter.get("/asset-issuers", reviewer, async (_req, res) => {
  res.json(await listIssuers());
});

opsRouter.post("/asset-issuers", reviewer, validate({ body: issuerRequestSchema }), async (req, res) => {
  res.status(201).json(await createIssuer(ctx(req), req.body as IssuerRequest));
});

opsRouter.patch("/asset-issuers/:id", reviewer, validate({ params: idParam, body: updateIssuerRequestSchema }), async (req, res) => {
  res.json(await updateIssuer(ctx(req), req.params.id as string, req.body as UpdateIssuerRequest));
});

opsRouter.get("/asset-providers", reviewer, async (_req, res) => {
  res.json(await listAssetProviders());
});

opsRouter.post("/asset-providers", reviewer, validate({ body: assetProviderRequestSchema }), async (req, res) => {
  res.status(201).json(await createAssetProvider(ctx(req), req.body as AssetProviderRequest));
});

opsRouter.patch("/asset-providers/:id", reviewer, validate({ params: idParam, body: updateAssetProviderRequestSchema }), async (req, res) => {
  res.json(await updateAssetProvider(ctx(req), req.params.id as string, req.body as UpdateAssetProviderRequest));
});

opsRouter.get("/assets/:id/prices", reviewer, validate({ params: idParam }), async (req, res) => {
  res.json((await getAssetForOps(req.params.id as string)).prices);
});

opsRouter.post("/assets/:id/submit", reviewer, validate({ params: idParam }), async (req, res) => {
  res.json(await submitInstrument(ctx(req), req.params.id as string));
});

opsRouter.post("/assets/:id/decision", requireRole("ops_admin"), validate({ params: idParam, body: assetDecisionRequestSchema }), async (req, res) => {
  res.json(await decideInstrument(ctx(req), req.params.id as string, req.body as AssetDecisionRequest));
});

for (const action of ["activate", "pause", "resume", "deprecate", "retire"] as const) {
  opsRouter.post(`/assets/:id/${action}`, requireRole("ops_admin"), validate({ params: idParam }), async (req, res) => {
    res.json(await transitionInstrument(ctx(req), req.params.id as string, action));
  });
}

for (const kind of ["deployments", "routes"] as const) {
  for (const action of ["approve", "activate", "pause", "resume", "retire"] as const) {
    opsRouter.post(`/assets/:id/${kind}/:itemId/${action}`, requireRole("ops_admin"), validate({ params: z.object({ id: z.uuid(), itemId: z.uuid() }) }), async (req, res) => {
      res.json(await transitionAssetItem(ctx(req), req.params.id as string, kind, req.params.itemId as string, action));
    });
  }
}

const basketParam = z.object({ bid: z.uuid() });

opsRouter.get("/baskets", requireRole("ops_reviewer"), async (req, res) => {
  res.json(await listBasketsForOps(listOpsBasketsQuerySchema.parse(req.query)));
});

opsRouter.get("/baskets/:bid", requireRole("ops_reviewer"), validate({ params: basketParam }), async (req, res) => {
  res.json(await getBasketForOps(req.params.bid as string));
});

// A reviewer may decide changes required, reject and escalate; the service requires ops_admin for an approval.
opsRouter.post("/baskets/:bid/versions/:vid/decision", requireRole("ops_reviewer"), validate({ params: z.object({ bid: z.uuid(), vid: z.uuid() }), body: basketReviewDecisionRequestSchema }), async (req, res) => {
  res.json(await decideBasketVersion(ctx(req), req.params.bid as string, req.params.vid as string, req.body as BasketReviewDecisionRequest));
});

opsRouter.post("/baskets/:bid/assignments/:aid/decision", requireRole("ops_admin"), validate({ params: z.object({ bid: z.uuid(), aid: z.uuid() }), body: basketApprovalRequestSchema }), async (req, res) => {
  res.json(await decideLead(ctx(req), req.params.bid as string, req.params.aid as string, req.body as BasketApprovalRequest));
});

opsRouter.post("/baskets/:bid/pause", requireRole("ops_reviewer"), validate({ params: basketParam, body: basketReasonRequestSchema }), async (req, res) => {
  res.json(await platformPause(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
});

opsRouter.post("/baskets/:bid/resume", requireRole("ops_admin"), validate({ params: basketParam }), async (req, res) => {
  res.json(await platformResume(ctx(req), req.params.bid as string));
});

opsRouter.post("/baskets/:bid/retire", requireRole("ops_admin"), validate({ params: basketParam, body: basketReasonRequestSchema }), async (req, res) => {
  res.json(await platformRetire(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
});

opsRouter.post("/baskets/:bid/retirement/decision", requireRole("ops_admin"), validate({ params: basketParam, body: basketApprovalRequestSchema }), async (req, res) => {
  res.json(await decideRetirement(ctx(req), req.params.bid as string, req.body as BasketApprovalRequest));
});

opsRouter.get("/disclosure-templates", requireRole("ops_admin"), async (_req, res) => {
  res.json(await listDisclosureTemplates());
});

opsRouter.post("/disclosure-templates", requireRole("ops_admin"), validate({ body: createDisclosureTemplateRequestSchema }), async (req, res) => {
  res.status(201).json(await createDisclosureTemplate(ctx(req), req.body as CreateDisclosureTemplateRequest));
});

opsRouter.post("/disclosure-templates/:id/retire", requireRole("ops_admin"), validate({ params: idParam }), async (req, res) => {
  res.json(await retireDisclosureTemplate(ctx(req), req.params.id as string));
});

opsRouter.get("/asset-tags", reviewer, async (_req, res) => {
  res.json(await listAssetTags());
});

opsRouter.post("/asset-tags", requireRole("ops_admin"), validate({ body: createAssetTagRequestSchema }), async (req, res) => {
  res.status(201).json(await createAssetTag(ctx(req), req.body as CreateAssetTagRequest));
});

opsRouter.post("/asset-tags/:id/retire", requireRole("ops_admin"), validate({ params: idParam }), async (req, res) => {
  res.json(await retireAssetTag(ctx(req), req.params.id as string));
});

opsRouter.get("/manager-profiles", reviewer, async (req, res) => {
  res.json(await listProfilesForOps(listOpsManagerProfilesQuerySchema.parse(req.query)));
});

opsRouter.post("/manager-profiles/:id/hide", reviewer, validate({ params: idParam, body: hideManagerProfileRequestSchema }), async (req, res) => {
  res.json(await hideProfile(ctx(req), req.params.id as string, req.body as HideManagerProfileRequest));
});

opsRouter.post("/manager-profiles/:id/unhide", reviewer, validate({ params: idParam }), async (req, res) => {
  res.json(await unhideProfile(ctx(req), req.params.id as string));
});
