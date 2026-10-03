import type { NextFunction, Request, Response } from "express";
import type { InvestRequest, SellRequest, RebalanceRequest, RepairRequest, LegSubmit } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as operationsService from "@/services/operations";
import * as rebalanceService from "@/services/rebalance";

const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const createInvestPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.operationsUser, req.auth!.userId);
    res.status(201).json(await operationsService.createInvestPlan(ctx(req), req.body as InvestRequest));
  } catch (error) {
    next(error);
  }
};

export const createSellPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.operationsUser, req.auth!.userId);
    res.status(201).json(await operationsService.createSellPlan(ctx(req), req.body as SellRequest));
  } catch (error) {
    next(error);
  }
};

export const createRebalancePlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.operationsUser, req.auth!.userId);
    const plan = await rebalanceService.createRebalancePlan(ctx(req), req.body as RebalanceRequest);
    res.status("aligned" in plan ? 200 : 201).json(plan);
  } catch (error) {
    next(error);
  }
};

export const createRepairPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.operationsUser, req.auth!.userId);
    res.status(201).json(await rebalanceService.createRepairPlan(ctx(req), req.body as RepairRequest));
  } catch (error) {
    next(error);
  }
};

export const getOperation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await operationsService.getOperation(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const quoteLeg = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.quotesUser, req.auth!.userId);
    res.json(await operationsService.quoteLeg(ctx(req), req.params.id as string, req.params.legId as string));
  } catch (error) {
    next(error);
  }
};

export const submitLeg = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.submitsUser, req.auth!.userId);
    res.json(await operationsService.submitLeg(ctx(req), req.params.id as string, req.params.legId as string, req.body as LegSubmit));
  } catch (error) {
    next(error);
  }
};

export const cancelOperation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await operationsService.cancelOperation(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
