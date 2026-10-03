import type { NextFunction, Request, Response } from "express";
import { publicBasketQuerySchema } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as publicBasketsService from "./public-baskets.service";

export const listPublicBaskets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.publicBasketIp, req.ctx.ip);
    res.json(await publicBasketsService.listPublicBaskets(publicBasketQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getPublicBasket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.publicBasketIp, req.ctx.ip);
    if (req.auth) res.set("Cache-Control", "private, no-store"); // the response carries this viewer's eligibility
    res.json(await publicBasketsService.getPublicBasket(req.params.slug as string, req.auth ? { userId: req.auth.userId, ipCountry: req.ctx.ipCountry } : null));
  } catch (error) {
    next(error);
  }
};
