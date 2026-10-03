import type { NextFunction, Request, Response } from "express";
import type { CreateApplicationRequest, ConfirmApplicationEmailRequest, ApplicationReplyRequest } from "@repo/validator";
import createHttpError from "http-errors";
import * as applicationsService from "./applications.service";

const tokenOf = (req: Request): string => {
  const token = req.header("x-application-token");
  if (!token) throw createHttpError("This status link is invalid or has expired.", { code: "APPLICATION_TOKEN_INVALID" });
  return token;
};

export const createApplication = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await applicationsService.createApplication(req.ctx, req.body as CreateApplicationRequest));
  } catch (error) {
    next(error);
  }
};

export const confirmApplicationEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await applicationsService.confirmApplicationEmail(req.ctx, req.params.id as string, (req.body as ConfirmApplicationEmailRequest).code));
  } catch (error) {
    next(error);
  }
};

export const resendApplicationCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await applicationsService.resendApplicationCode(req.ctx, req.params.id as string);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const getApplicationStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await applicationsService.getApplicationStatus(tokenOf(req)));
  } catch (error) {
    next(error);
  }
};

export const replyToApplication = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await applicationsService.replyToApplication(req.ctx, tokenOf(req), (req.body as ApplicationReplyRequest).message);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
