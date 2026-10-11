import express from "express";
import { investRequestSchema, sellRequestSchema, rebalanceRequestSchema, repairRequestSchema, legSubmitSchema, groupRequestSchema, groupSubmitSchema, groupSentSchema, continueRequestSchema, z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import * as operationsService from "./operations.service";
import { cancelOperation, claimGroup, continueOperation, createInvestPlan, createRebalancePlan, createRepairPlan, createSellPlan, getOperation, quoteLeg, releaseGroup, requestGroup, sentGroup, submitGroup, submitLeg } from "./operations.controller";

const idParam = z.object({ id: z.uuid() });

const legParams = z.object({ id: z.uuid(), legId: z.uuid() });

const groupParams = z.object({ id: z.uuid(), groupId: z.uuid() });

const router: express.Router = express.Router();

router.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await operationsService.assertVerifiedContacts(req.auth!.userId);
  next();
});

router.post("/invest", validate({ body: investRequestSchema }), createInvestPlan);

router.post("/sell", validate({ body: sellRequestSchema }), createSellPlan);

router.post("/rebalance", validate({ body: rebalanceRequestSchema }), createRebalancePlan);

router.post("/repair", validate({ body: repairRequestSchema }), createRepairPlan);

router.get("/:id", validate({ params: idParam }), getOperation);

router.post("/:id/legs/:legId/quote", validate({ params: legParams }), quoteLeg);

router.post("/:id/legs/:legId/submit", validate({ params: legParams, body: legSubmitSchema }), submitLeg);

router.post("/:id/groups", validate({ params: idParam, body: groupRequestSchema }), requestGroup);

router.post("/:id/groups/:groupId/submit", validate({ params: groupParams, body: groupSubmitSchema }), submitGroup);

router.post("/:id/groups/:groupId/claim", validate({ params: groupParams }), claimGroup);

router.post("/:id/groups/:groupId/sent", validate({ params: groupParams, body: groupSentSchema }), sentGroup);

router.post("/:id/groups/:groupId/release", validate({ params: groupParams }), releaseGroup);

router.post("/:id/continue", validate({ params: idParam, body: continueRequestSchema }), continueOperation);

router.post("/:id/cancel", validate({ params: idParam }), cancelOperation);

export default router;
