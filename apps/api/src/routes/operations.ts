import createHttpError from "http-errors";
import { Router, type Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { contacts, db } from "@repo/db";
import { investRequestSchema, legSubmitSchema, rebalanceRequestSchema, repairRequestSchema, sellRequestSchema, z, type InvestRequest, type LegSubmit, type RebalanceRequest, type RepairRequest, type SellRequest } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { createRebalancePlan, createRepairPlan } from "../services/rebalance";
import { cancelOperation, createInvestPlan, createSellPlan, getOperation, quoteLeg, submitLeg } from "../services/operations";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });
const idParam = z.object({ id: z.uuid() });
const legParams = z.object({ id: z.uuid(), legId: z.uuid() });

/** Operations move money: every mutation needs a verified email and phone (reads do not). */
export const operationsRouter = Router();
operationsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method === "GET") return next();
  const verified = await db.select({ type: contacts.type }).from(contacts).where(and(eq(contacts.userId, req.auth!.userId), eq(contacts.status, "verified"), inArray(contacts.type, ["email", "phone"])));
  if (verified.length < 2) throw createHttpError(409, "Verify your email and phone before investing.", { code: "NOT_ELIGIBLE" });
  next();
});

operationsRouter.post("/invest", validate({ body: investRequestSchema }), async (req, res) => {
  await consume(limits.operationsUser, req.auth!.userId);
  res.status(201).json(await createInvestPlan(ctx(req), req.body as InvestRequest));
});

operationsRouter.post("/sell", validate({ body: sellRequestSchema }), async (req, res) => {
  await consume(limits.operationsUser, req.auth!.userId);
  res.status(201).json(await createSellPlan(ctx(req), req.body as SellRequest));
});

operationsRouter.post("/rebalance", validate({ body: rebalanceRequestSchema }), async (req, res) => {
  await consume(limits.operationsUser, req.auth!.userId);
  const plan = await createRebalancePlan(ctx(req), req.body as RebalanceRequest);
  res.status("aligned" in plan ? 200 : 201).json(plan);
});

operationsRouter.post("/repair", validate({ body: repairRequestSchema }), async (req, res) => {
  await consume(limits.operationsUser, req.auth!.userId);
  res.status(201).json(await createRepairPlan(ctx(req), req.body as RepairRequest));
});

operationsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json(await getOperation(ctx(req), req.params.id as string));
});

operationsRouter.post("/:id/legs/:legId/quote", validate({ params: legParams }), async (req, res) => {
  await consume(limits.quotesUser, req.auth!.userId);
  res.json(await quoteLeg(ctx(req), req.params.id as string, req.params.legId as string));
});

operationsRouter.post("/:id/legs/:legId/submit", validate({ params: legParams, body: legSubmitSchema }), async (req, res) => {
  await consume(limits.submitsUser, req.auth!.userId);
  res.json(await submitLeg(ctx(req), req.params.id as string, req.params.legId as string, req.body as LegSubmit));
});

operationsRouter.post("/:id/cancel", validate({ params: idParam }), async (req, res) => {
  res.json(await cancelOperation(ctx(req), req.params.id as string));
});
