import { Router, type Request } from "express";
import { z } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { leavePosition } from "../services/operations";
import { getPortfolio } from "../services/positions";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const portfolioRouter = Router();
portfolioRouter.use(requireSession);
portfolioRouter.get("/", async (req, res) => {
  res.json(await getPortfolio(ctx(req)));
});

export const positionsRouter = Router();
positionsRouter.use(requireSession);
positionsRouter.post("/:id/leave", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  await leavePosition(ctx(req), req.params.id as string);
  res.status(204).end();
});
