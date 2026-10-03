import type { NextFunction, Request, Response } from "express";
import { listBasketsQuerySchema, type CreateBasketRequest } from "@repo/validator";
import * as basketsService from "./baskets.service";
import { ctx } from "@/middlewares/request-context.middleware";


export const createBasket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await basketsService.createBasket(ctx(req), req.params.id as string, req.body as CreateBasketRequest));
  } catch (error) {
    next(error);
  }
};

export const listOrgBaskets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.listOrgBaskets(ctx(req), req.params.id as string, listBasketsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};
