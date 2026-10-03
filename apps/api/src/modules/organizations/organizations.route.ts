import express from "express";
import { createOrganizationRequestSchema, updateDraftRequestSchema, presignDocumentRequestSchema, enterPayoutWalletRequestSchema, verifyPayoutWalletRequestSchema, z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import basketsOrgRouter from "@/modules/baskets/baskets.org.route";
import feesOrgRouter from "@/modules/fees/fees.org.route";
import membersOrgRouter from "@/modules/members/members.org.route";
import { confirmDocument, createChangeRequest, createOrganization, enterPayoutWallet, getOrganizationForMember, issuePayoutChallenge, listMyOrganizations, presignDocument, submitChangeRequest, submitOrganization, unlinkDocument, updateDraft, verifyPayoutWallet } from "./organizations.controller";

const idParam = z.object({ id: z.uuid() });

const docParams = z.object({ id: z.uuid(), docId: z.uuid() });

const router: express.Router = express.Router();

router.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

router.post("/", validate({ body: createOrganizationRequestSchema }), createOrganization);

router.get("/mine", listMyOrganizations);

router.get("/:id", validate({ params: idParam }), getOrganizationForMember);

router.patch("/:id/draft", validate({ params: idParam, body: updateDraftRequestSchema }), updateDraft);

router.post("/:id/documents", validate({ params: idParam, body: presignDocumentRequestSchema }), presignDocument);

router.post("/:id/documents/:docId/confirm", validate({ params: docParams }), confirmDocument);

router.delete("/:id/draft/documents/:docId", validate({ params: docParams }), unlinkDocument);

router.post("/:id/payout-wallet", validate({ params: idParam, body: enterPayoutWalletRequestSchema }), enterPayoutWallet);

router.post("/:id/payout-wallet/challenge", validate({ params: idParam }), issuePayoutChallenge);

router.post("/:id/payout-wallet/verify", validate({ params: idParam, body: verifyPayoutWalletRequestSchema }), verifyPayoutWallet);

router.post("/:id/submit", validate({ params: idParam }), submitOrganization);

router.post("/:id/change-request", validate({ params: idParam }), createChangeRequest);

router.post("/:id/change-request/submit", validate({ params: idParam }), submitChangeRequest);

// Served after the session and rate-limit middleware above.
router.use(membersOrgRouter, basketsOrgRouter, feesOrgRouter);

export default router;
