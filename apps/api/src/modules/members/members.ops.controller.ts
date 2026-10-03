import type { NextFunction, Request, Response } from "express";
import { listMemberReviewQuerySchema, type DecideMemberVerificationRequest, type TransferOwnershipRequest } from "@repo/validator";
import * as memberVerificationsService from "./member-verifications.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

export const listMembersForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.listMembersForReview(listMemberReviewQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getMemberForReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.getMemberForReview(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const decideMemberVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.decideMemberVerification(ctx(req), req.params.mid as string, req.body as DecideMemberVerificationRequest));
  } catch (error) {
    next(error);
  }
};

export const memberDocumentDownloadUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.set("Cache-Control", "no-store").redirect(302, await memberVerificationsService.memberDocumentDownloadUrl(ctx(req), req.params.mid as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const transferOwnership = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await memberVerificationsService.transferOwnership(ctx(req), req.params.id as string, req.body as TransferOwnershipRequest);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
