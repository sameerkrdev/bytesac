import type { NextFunction, Request, Response } from "express";
import type { CreateOrganizationRequest, UpdateDraftRequest, PresignDocumentRequest, EnterPayoutWalletRequest, VerifyPayoutWalletRequest } from "@repo/validator";
import * as organizationsService from "./organizations.service";
import * as payoutWalletsService from "./payout-wallets.service";
import { ctx } from "@/middlewares/request-context.middleware";


export const createOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await organizationsService.createOrganization(ctx(req), req.body as CreateOrganizationRequest));
  } catch (error) {
    next(error);
  }
};

export const listMyOrganizations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.listMyOrganizations(req.auth!.userId));
  } catch (error) {
    next(error);
  }
};

export const getOrganizationForMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.getOrganizationForMember(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const updateDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.updateDraft(ctx(req), req.params.id as string, req.body as UpdateDraftRequest));
  } catch (error) {
    next(error);
  }
};

export const presignDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await organizationsService.presignDocument(ctx(req), req.params.id as string, req.body as PresignDocumentRequest));
  } catch (error) {
    next(error);
  }
};

export const confirmDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.confirmDocument(ctx(req), req.params.id as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const unlinkDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.unlinkDocument(ctx(req), req.params.id as string, req.params.docId as string));
  } catch (error) {
    next(error);
  }
};

export const enterPayoutWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await payoutWalletsService.enterPayoutWallet(ctx(req), req.params.id as string, (req.body as EnterPayoutWalletRequest).address));
  } catch (error) {
    next(error);
  }
};

export const issuePayoutChallenge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await payoutWalletsService.issuePayoutChallenge(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const verifyPayoutWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await payoutWalletsService.verifyPayoutWallet(ctx(req), req.params.id as string, req.body as VerifyPayoutWalletRequest));
  } catch (error) {
    next(error);
  }
};

export const submitOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.submitOrganization(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const createChangeRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await organizationsService.createChangeRequest(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const submitChangeRequest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await organizationsService.submitChangeRequest(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
