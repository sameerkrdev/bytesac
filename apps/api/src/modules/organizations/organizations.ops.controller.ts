import type { NextFunction, Request, Response } from "express";
import { listOrganizationsQuerySchema, type TransitionOrganizationRequest, type VersionDecisionRequest, type PayoutWalletDecisionRequest, type OrganizationNoteRequest } from "@repo/validator";
import * as organizationReviewService from "./organization-review.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

export const listOrganizationsForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationReviewService.listOrganizationsForReview(listOrganizationsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getOrganizationForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationReviewService.getOrganizationForReview(req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const transitionOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationReviewService.transitionOrganization(ctx(req), req.params.id as string, req.body as TransitionOrganizationRequest));
  } catch (error) {
    next(error);
  }
};

export const decideVersion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationReviewService.decideVersion(ctx(req), req.params.id as string, req.params.versionId as string, req.body as VersionDecisionRequest));
  } catch (error) {
    next(error);
  }
};

export const decidePayoutWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationReviewService.decidePayoutWallet(ctx(req), req.params.id as string, req.params.walletId as string, req.body as PayoutWalletDecisionRequest));
  } catch (error) {
    next(error);
  }
};

export const addOrganizationNote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await organizationReviewService.addOrganizationNote(ctx(req), req.params.id as string, (req.body as OrganizationNoteRequest).internalNote));
  } catch (error) {
    next(error);
  }
};

export const documentDownloadUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.set("Cache-Control", "no-store").redirect(302, await organizationReviewService.documentDownloadUrl(ctx(req), req.params.id as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};
