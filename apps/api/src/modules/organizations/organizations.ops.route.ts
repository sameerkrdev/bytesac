import express from "express";
import { transitionOrganizationRequestSchema, z, versionDecisionRequestSchema, payoutWalletDecisionRequestSchema, organizationNoteRequestSchema } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { addOrganizationNote, decidePayoutWallet, decideVersion, documentDownloadUrl, getOrganizationForReview, listOrganizationsForReview, transitionOrganization } from "./organizations.ops.controller";

const idParam = z.object({ id: z.uuid() });

const router: express.Router = express.Router();

router.get("/organizations", requireRole("ops_reviewer"), listOrganizationsForReview);

router.get("/organizations/:id", requireRole("ops_reviewer"), validate({ params: idParam }), getOrganizationForReview);

router.post("/organizations/:id/transition", requireRole("ops_reviewer"), validate({ params: idParam, body: transitionOrganizationRequestSchema }), transitionOrganization);

router.post("/organizations/:id/versions/:versionId/decision", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), versionId: z.uuid() }), body: versionDecisionRequestSchema }), decideVersion);

router.post("/organizations/:id/payout-wallets/:walletId/decision", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), walletId: z.uuid() }), body: payoutWalletDecisionRequestSchema }), decidePayoutWallet);

router.post("/organizations/:id/notes", requireRole("ops_reviewer"), validate({ params: idParam, body: organizationNoteRequestSchema }), addOrganizationNote);

router.get("/organizations/:id/documents/:docId/download", requireRole("ops_reviewer"), validate({ params: z.object({ id: z.uuid(), docId: z.uuid() }) }), documentDownloadUrl);

export default router;
