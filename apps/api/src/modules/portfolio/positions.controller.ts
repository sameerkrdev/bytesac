import type { NextFunction, Request, Response } from "express";
import type { SkipRequest } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as rebalanceService from "@/modules/rebalance/rebalance.service";
import * as operationsService from "@/modules/operations/operations.service";
import { ctx } from "@/middlewares/request-context.middleware";


export const skipVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await rebalanceService.skipVersion(ctx(req), req.params.id as string, req.body as SkipRequest);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const keepCustom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await rebalanceService.keepCustom(ctx(req), req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const revertCustom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await rebalanceService.revertCustom(ctx(req), req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const closeDustPosition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await rebalanceService.closeDustPosition(ctx(req), req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const leavePosition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await operationsService.leavePosition(ctx(req), req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
