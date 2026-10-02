import { Router, type Request } from "express";
import { skipRequestSchema, syncRequestSchema, z, type SkipRequest, type SyncRequest } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { leavePosition } from "../services/operations";
import { getPortfolio } from "../services/positions";
import { keepCustom, revertCustom, skipVersion, syncShortfall } from "../services/rebalance";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const portfolioRouter = Router();
portfolioRouter.use(requireSession);
portfolioRouter.get("/", async (req, res) => {
  res.json(await getPortfolio(ctx(req)));
});

portfolioRouter.post("/sync", validate({ body: syncRequestSchema }), async (req, res) => {
  await consume(limits.syncUser, req.auth!.userId);
  res.json(await syncShortfall(ctx(req), req.body as SyncRequest));
});

export const positionsRouter = Router();
positionsRouter.use(requireSession);
const positionParam = validate({ params: z.object({ id: z.uuid() }) });
positionsRouter.post("/:id/skip", validate({ params: z.object({ id: z.uuid() }), body: skipRequestSchema }), async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await skipVersion(ctx(req), req.params.id as string, req.body as SkipRequest);
  res.status(204).end();
});
positionsRouter.post("/:id/custom", positionParam, async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await keepCustom(ctx(req), req.params.id as string);
  res.status(204).end();
});
positionsRouter.post("/:id/custom/revert", positionParam, async (req, res) => {
  await consume(limits.notificationsUser, req.auth!.userId);
  await revertCustom(ctx(req), req.params.id as string);
  res.status(204).end();
});
positionsRouter.post("/:id/leave", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  await leavePosition(ctx(req), req.params.id as string);
  res.status(204).end();
});
