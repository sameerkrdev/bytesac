import type { NextFunction, Request, Response } from "express";
import type { MembershipProfileRequest, UpdateMemberVerificationRequest, PresignDocumentRequest } from "@repo/validator";
import * as membersService from "./members.service";
import * as memberVerificationsService from "./member-verifications.service";
import { ctx } from "@/middlewares/request-context.middleware";


export const getMembership = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.getMyMembership(req.auth!.userId, req.params.mid as string, req.ctx.requestId));
  } catch (error) {
    next(error);
  }
};

export const acceptInvitation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.acceptInvitation(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const declineInvitation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.declineInvitation(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const leaveOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.leaveOrganization(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const updateMembershipProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.updateMembershipProfile(ctx(req), req.params.mid as string, req.body as MembershipProfileRequest));
  } catch (error) {
    next(error);
  }
};

export const getMemberVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.getMemberVerification(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};

export const updateMemberVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.updateMemberVerification(ctx(req), req.params.mid as string, req.body as UpdateMemberVerificationRequest));
  } catch (error) {
    next(error);
  }
};

export const presignMemberDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await memberVerificationsService.presignMemberDocument(ctx(req), req.params.mid as string, req.body as PresignDocumentRequest));
  } catch (error) {
    next(error);
  }
};

export const confirmMemberDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.confirmMemberDocument(ctx(req), req.params.mid as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const unlinkMemberDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.unlinkMemberDocument(ctx(req), req.params.mid as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const submitMemberVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await memberVerificationsService.submitMemberVerification(ctx(req), req.params.mid as string));
  } catch (error) {
    next(error);
  }
};
