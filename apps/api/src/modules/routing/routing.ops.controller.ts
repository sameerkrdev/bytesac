import type { NextFunction, Request, Response } from "express";
import type { RoutePolicyInput } from "@repo/validator";
import * as routingService from "./routing.service";
import { opsCtx } from "@/middlewares/request-context.middleware";


export const getLifiTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await routingService.getLifiTransfers(req.params.id as string, req.params.legId as string));
  } catch (error) {
    next(error);
  }
};

export const getRouting = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await routingService.getRouting());
  } catch (error) {
    next(error);
  }
};

export const denyTool = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await routingService.denyTool(opsCtx(req), req.body as RoutePolicyInput));
  } catch (error) {
    next(error);
  }
};

export const allowTool = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await routingService.allowTool(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
