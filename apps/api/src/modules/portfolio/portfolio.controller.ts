import type { NextFunction, Request, Response } from "express";
import type { SyncRequest } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as portfolioService from "./portfolio.service";
import * as rebalanceService from "@/modules/rebalance/rebalance.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const getPortfolio = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await portfolioService.getPortfolio(ctx(req)));
  } catch (error) {
    next(error);
  }
};

export const syncShortfall = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.syncUser, req.auth!.userId);
    res.json(await rebalanceService.syncShortfall(ctx(req), req.body as SyncRequest));
  } catch (error) {
    next(error);
  }
};
