import type { NextFunction, Request, Response } from "express";
import type { ManagerProfileRequest } from "@repo/validator";
import * as managerProfilesService from "./manager-profiles.service";

export const getOwnProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.getOwnProfile(req.auth!.userId));
  } catch (error) {
    next(error);
  }
};

export const saveOwnProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.saveOwnProfile(req.auth!.userId, req.body as ManagerProfileRequest));
  } catch (error) {
    next(error);
  }
};

export const publishProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.setOwnProfilePublished({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, requestId: req.ctx.requestId }, true));
  } catch (error) {
    next(error);
  }
};

export const unpublishProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.setOwnProfilePublished({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, requestId: req.ctx.requestId }, false));
  } catch (error) {
    next(error);
  }
};
