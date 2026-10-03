import type { NextFunction, Request, Response } from "express";
import { listOpsBasketsQuerySchema, type BasketReviewDecisionRequest, type BasketApprovalRequest, type BasketReasonRequest, type CreateDisclosureTemplateRequest } from "@repo/validator";
import * as basketReviewService from "./basket-review.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

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
    res.json(await basketReviewService.decideVersion(ctx(req), req.params.bid as string, req.params.vid as string, req.body as BasketReviewDecisionRequest));
  } catch (error) {
    next(error);
  }
};

export const decideLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.decideLead(ctx(req), req.params.bid as string, req.params.aid as string, req.body as BasketApprovalRequest));
  } catch (error) {
    next(error);
  }
};

export const platformPause = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformPause(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};

export const platformResume = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformResume(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const platformRetire = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.platformRetire(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};

export const decideRetirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.decideRetirement(ctx(req), req.params.bid as string, req.body as BasketApprovalRequest));
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
    res.status(201).json(await basketReviewService.createDisclosureTemplate(ctx(req), req.body as CreateDisclosureTemplateRequest));
  } catch (error) {
    next(error);
  }
};

export const retireDisclosureTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.retireDisclosureTemplate(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
