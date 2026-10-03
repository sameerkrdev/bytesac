import express from "express";
import { z, basketReviewDecisionRequestSchema, basketApprovalRequestSchema, basketReasonRequestSchema, createDisclosureTemplateRequestSchema } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { createDisclosureTemplate, decideBasketVersion, decideLead, decideRetirement, getBasketForOps, listBasketsForOps, listDisclosureTemplates, platformPause, platformResume, platformRetire, retireDisclosureTemplate } from "./baskets.ops.controller";

const idParam = z.object({ id: z.uuid() });

const basketParam = z.object({ bid: z.uuid() });

const router: express.Router = express.Router();

router.get("/baskets", requireRole("ops_reviewer"), listBasketsForOps);

router.get("/baskets/:bid", requireRole("ops_reviewer"), validate({ params: basketParam }), getBasketForOps);

// A reviewer may decide changes required, reject and escalate; the service requires ops_admin for an approval.
router.post("/baskets/:bid/versions/:vid/decision", requireRole("ops_reviewer"), validate({ params: z.object({ bid: z.uuid(), vid: z.uuid() }), body: basketReviewDecisionRequestSchema }), decideBasketVersion);

router.post("/baskets/:bid/assignments/:aid/decision", requireRole("ops_admin"), validate({ params: z.object({ bid: z.uuid(), aid: z.uuid() }), body: basketApprovalRequestSchema }), decideLead);

router.post("/baskets/:bid/pause", requireRole("ops_reviewer"), validate({ params: basketParam, body: basketReasonRequestSchema }), platformPause);

router.post("/baskets/:bid/resume", requireRole("ops_admin"), validate({ params: basketParam }), platformResume);

router.post("/baskets/:bid/retire", requireRole("ops_admin"), validate({ params: basketParam, body: basketReasonRequestSchema }), platformRetire);

router.post("/baskets/:bid/retirement/decision", requireRole("ops_admin"), validate({ params: basketParam, body: basketApprovalRequestSchema }), decideRetirement);

router.get("/disclosure-templates", requireRole("ops_admin"), listDisclosureTemplates);

router.post("/disclosure-templates", requireRole("ops_admin"), validate({ body: createDisclosureTemplateRequestSchema }), createDisclosureTemplate);

router.post("/disclosure-templates/:id/retire", requireRole("ops_admin"), validate({ params: idParam }), retireDisclosureTemplate);

export default router;
