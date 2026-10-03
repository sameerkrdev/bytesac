import express from "express";
import { membershipProfileRequestSchema, updateMemberVerificationRequestSchema, presignDocumentRequestSchema, z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { acceptInvitation, confirmMemberDocument, declineInvitation, getMemberVerification, getMembership, leaveOrganization, presignMemberDocument, submitMemberVerification, unlinkMemberDocument, updateMemberVerification, updateMembershipProfile } from "./members.controller";

const midParam = z.object({ mid: z.uuid() });

const docParams = z.object({ mid: z.uuid(), docId: z.uuid() });

const router: express.Router = express.Router();

router.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

router.get("/:mid", validate({ params: midParam }), getMembership);

router.post("/:mid/accept", validate({ params: midParam }), acceptInvitation);

router.post("/:mid/decline", validate({ params: midParam }), declineInvitation);

router.post("/:mid/leave", validate({ params: midParam }), leaveOrganization);

router.patch("/:mid/profile", validate({ params: midParam, body: membershipProfileRequestSchema }), updateMembershipProfile);

router.get("/:mid/verification", validate({ params: midParam }), getMemberVerification);

router.patch("/:mid/verification", validate({ params: midParam, body: updateMemberVerificationRequestSchema }), updateMemberVerification);

router.post("/:mid/verification/documents", validate({ params: midParam, body: presignDocumentRequestSchema }), presignMemberDocument);

router.post("/:mid/verification/documents/:docId/confirm", validate({ params: docParams }), confirmMemberDocument);

router.delete("/:mid/verification/documents/:docId", validate({ params: docParams }), unlinkMemberDocument);

router.post("/:mid/verification/submit", validate({ params: midParam }), submitMemberVerification);

export default router;
