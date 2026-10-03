import type { NextFunction, Request, Response } from "express";
import { listMemberReviewQuerySchema, type DecideMemberVerificationRequest, type TransferOwnershipRequest } from "@repo/validator";
import * as memberVerificationsService from "./member-verifications.service";
import { opsCtx } from "@/middlewares/request-context.middleware";


export const listMembersForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.listMembersForReview(listMemberReviewQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getMemberForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.getMemberForReview(opsCtx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const decideMemberVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.decideMemberVerification(opsCtx(req), req.params.mid as string, req.body as DecideMemberVerificationRequest));
  } catch (error) {
    next(error);
  }
};

export const memberDocumentDownloadUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.set("Cache-Control", "no-store").redirect(302, await memberVerificationsService.memberDocumentDownloadUrl(opsCtx(req), req.params.mid as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const transferOwnership = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await memberVerificationsService.transferOwnership(opsCtx(req), req.params.id as string, req.body as TransferOwnershipRequest);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
