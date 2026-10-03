import type { NextFunction, Request, Response } from "express";
import { listOpsManagerProfilesQuerySchema, type HideManagerProfileRequest } from "@repo/validator";
import * as managerProfilesService from "./manager-profiles.service";
import { opsCtx } from "@/middlewares/request-context.middleware";


export const listProfilesForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.listProfilesForOps(listOpsManagerProfilesQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const hideProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.hideProfile(opsCtx(req), req.params.id as string, req.body as HideManagerProfileRequest));
  } catch (error) {
    next(error);
  }
};

export const unhideProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.unhideProfile(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
