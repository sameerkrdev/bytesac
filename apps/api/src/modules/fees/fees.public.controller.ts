import type { NextFunction, Request, Response } from "express";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as publicBasketsService from "@/modules/baskets/public-baskets.service";

export const platformFeeRates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.publicBasketIp, req.ctx.ip);
    res.json({ platform: await publicBasketsService.platformFeeRates(null, null) });
  } catch (error) {
    next(error);
  }
};
