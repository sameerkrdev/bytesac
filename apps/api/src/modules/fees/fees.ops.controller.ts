import type { NextFunction, Request, Response } from "express";
import { earningsQuerySchema, type PlatformFeeScheduleInput, type PlatformFeeOverrideInput } from "@repo/validator";
import * as feesService from "@/services/fees";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

const actor = (req: Request) => ({ userId: req.auth!.userId, requestId: req.ctx.requestId });

export const listSchedules = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await feesService.listSchedules(false));
  } catch (error) {
    next(error);
  }
};

export const saveSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await feesService.saveSchedule(actor(req), req.body as PlatformFeeScheduleInput));
  } catch (error) {
    next(error);
  }
};

export const listOverrides = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await feesService.listSchedules(true));
  } catch (error) {
    next(error);
  }
};

export const saveOverride = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await feesService.saveSchedule(actor(req), req.body as PlatformFeeOverrideInput));
  } catch (error) {
    next(error);
  }
};

export const endOverride = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await feesService.endOverride(actor(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const getRevenue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = earningsQuerySchema.parse(req.query);
    if (q.format === "csv") res.type("text/csv").attachment("revenue.csv").send(await feesService.getRevenueCsv(q));
    else res.json(await feesService.getRevenue(q));
  } catch (error) {
    next(error);
  }
};
