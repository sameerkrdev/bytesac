import express from "express";
import { decideMemberVerificationRequestSchema, z, transferOwnershipRequestSchema } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { decideMemberVerification, getMemberForReview, listMembersForReview, memberDocumentDownloadUrl, transferOwnership } from "./members.ops.controller";

const idParam = z.object({ id: z.uuid() });

const midParam = z.object({ mid: z.uuid() });

const router: express.Router = express.Router();

router.get("/members", requireRole("ops_reviewer"), listMembersForReview);

router.get("/members/:mid", requireRole("ops_reviewer"), validate({ params: midParam }), getMemberForReview);

router.post("/members/:mid/decision", requireRole("ops_reviewer"), validate({ params: midParam, body: decideMemberVerificationRequestSchema }), decideMemberVerification);

router.get("/members/:mid/documents/:docId/download", requireRole("ops_reviewer"), validate({ params: z.object({ mid: z.uuid(), docId: z.uuid() }) }), memberDocumentDownloadUrl);

router.post("/organizations/:id/transfer-ownership", requireRole("ops_admin"), validate({ params: idParam, body: transferOwnershipRequestSchema }), transferOwnership);

export default router;
