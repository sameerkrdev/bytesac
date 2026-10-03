import type { NextFunction, Request, Response } from "express";
import { db } from "@repo/db";
import type { Investability, SaveBasketDraftRequest, CreateAssignmentRequest, UpdateAssignmentRequest, EndAssignmentRequest, BasketReasonRequest } from "@repo/validator";
import * as basketsService from "./baskets.service";
import * as notificationsService from "@/modules/notifications/notifications.service";
import * as basketReviewService from "./basket-review.service";
import * as investabilityService from "@/modules/operations/investability.service";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { ctx } from "@/middlewares/request-context.middleware";


export const getBasketInvestability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.publicBasketIp, req.ctx.ip);
    const { basketId, investable, reasons, requiredFamilies, minimumUsdc, eligibility } = await investabilityService.getInvestability(db, { slug: req.params.slug as string }, req.auth ? { userId: req.auth.userId, ipCountry: req.ctx.ipCountry } : null);
    const body: Investability = { basketId, investable, reasons, requiredFamilies, minimumUsdc, eligibility };
    res.json(body);
  } catch (error) {
    next(error);
  }
};

export const getBasketForMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.getBasketForMember(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const getBasketAdoption = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await basketsService.requireBasketAction(db, req.auth!.userId, req.params.bid as string, "read");
    res.json(await notificationsService.getAdoption(req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const saveDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.saveDraft(ctx(req), req.params.bid as string, req.body as SaveBasketDraftRequest));
  } catch (error) {
    next(error);
  }
};

export const validateOpenVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.validateOpenVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const previewOpenVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.previewOpenVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const createNextVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await basketsService.createNextVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const listVersions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.listVersions(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const getVersionDiff = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.getVersionDiff(ctx(req), req.params.bid as string, req.params.vid as string));
  } catch (error) {
    next(error);
  }
};

export const addAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await basketsService.addAssignment(ctx(req), req.params.bid as string, req.body as CreateAssignmentRequest));
  } catch (error) {
    next(error);
  }
};

export const updateAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.updateAssignment(ctx(req), req.params.bid as string, req.params.aid as string, req.body as UpdateAssignmentRequest));
  } catch (error) {
    next(error);
  }
};

export const endAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketsService.endAssignment(ctx(req), req.params.bid as string, req.params.aid as string, req.body as EndAssignmentRequest));
  } catch (error) {
    next(error);
  }
};

export const submitVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.submitVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const withdrawVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.withdrawVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const publishVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.publishVersion(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const pauseBasket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.pauseBasket(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};

export const resumeBasket = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.resumeBasket(ctx(req), req.params.bid as string));
  } catch (error) {
    next(error);
  }
};

export const requestRetirement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await basketReviewService.requestRetirement(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
  } catch (error) {
    next(error);
  }
};
