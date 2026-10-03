import type { NextFunction, Request, Response } from "express";
import { listOpsBasketsQuerySchema, type BasketReviewDecisionRequest, type BasketApprovalRequest, type BasketReasonRequest, type CreateDisclosureTemplateRequest } from "@repo/validator";
import * as basketReviewService from "./basket-review.service";
import { opsCtx } from "@/middlewares/request-context.middleware";


export const listBasketsForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.listBasketsForOps(listOpsBasketsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getBasketForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.getBasketForOps(req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const decideBasketVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.decideVersion(opsCtx(req), req.params.bid as string, req.params.vid as string, req.body as BasketReviewDecisionRequest));
  } catch (error) {
    next(error);
  }
};

export const decideLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.decideLead(opsCtx(req), req.params.bid as string, req.params.aid as string, req.body as BasketApprovalRequest));
  } catch (error) {
    next(error);
  }
};

export const platformPause = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformPause(opsCtx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};

export const platformResume = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformResume(opsCtx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const platformRetire = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformRetire(opsCtx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};

export const decideRetirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.decideRetirement(opsCtx(req), req.params.bid as string, req.body as BasketApprovalRequest));
  } catch (error) {
    next(error);
  }
};

export const listDisclosureTemplates = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.listDisclosureTemplates());
  } catch (error) {
    next(error);
  }
};

export const createDisclosureTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await basketReviewService.createDisclosureTemplate(opsCtx(req), req.body as CreateDisclosureTemplateRequest));
  } catch (error) {
    next(error);
  }
};

export const retireDisclosureTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.retireDisclosureTemplate(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
