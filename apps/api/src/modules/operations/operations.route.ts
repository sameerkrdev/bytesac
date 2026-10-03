import express from "express";
import { db, contacts } from "@repo/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import { investRequestSchema, sellRequestSchema, rebalanceRequestSchema, repairRequestSchema, legSubmitSchema, z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { cancelOperation, createInvestPlan, createRebalancePlan, createRepairPlan, createSellPlan, getOperation, quoteLeg, submitLeg } from "./operations.controller";

const idParam = z.object({ id: z.uuid() });

const legParams = z.object({ id: z.uuid(), legId: z.uuid() });

const router: express.Router = express.Router();

router.use(requireSession, async (req, _res, next) => {
  if (req.method === "GET") return next();
  const verified = await db.select({ type: contacts.type }).from(contacts).where(and(eq(contacts.userId, req.auth!.userId), eq(contacts.status, "verified"), inArray(contacts.type, ["email", "phone"])));
  if (verified.length < 2) throw createHttpError(409, "Verify your email and phone before investing.", { code: "NOT_ELIGIBLE" });
  next();
});

router.post("/invest", validate({ body: investRequestSchema }), createInvestPlan);

router.post("/sell", validate({ body: sellRequestSchema }), createSellPlan);

router.post("/rebalance", validate({ body: rebalanceRequestSchema }), createRebalancePlan);

router.post("/repair", validate({ body: repairRequestSchema }), createRepairPlan);

router.get("/:id", validate({ params: idParam }), getOperation);

router.post("/:id/legs/:legId/quote", validate({ params: legParams }), quoteLeg);

router.post("/:id/legs/:legId/submit", validate({ params: legParams, body: legSubmitSchema }), submitLeg);

router.post("/:id/cancel", validate({ params: idParam }), cancelOperation);

export default router;
