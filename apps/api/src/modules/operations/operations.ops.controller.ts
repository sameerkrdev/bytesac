import type { NextFunction, Request, Response } from "express";
import type { ResolveLegRequest } from "@repo/validator";
import * as trackingService from "@/modules/portfolio/tracking.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

export const resolveLeg = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await trackingService.resolveLeg({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx }, req.params.id as string, req.params.legId as string, req.body as ResolveLegRequest));
  } catch (error) {
    next(error);
  }
};
