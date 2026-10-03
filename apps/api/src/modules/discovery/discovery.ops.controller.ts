import type { NextFunction, Request, Response } from "express";
import { listOpsManagerProfilesQuerySchema, type HideManagerProfileRequest } from "@repo/validator";
import * as managerProfilesService from "./manager-profiles.service";

const ctx = (req: Request) => ({ userId: req.auth!.userId, meta: req.ctx });

export const listProfilesForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.listProfilesForOps(listOpsManagerProfilesQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const hideProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.hideProfile(ctx(req), req.params.id as string, req.body as HideManagerProfileRequest));
  } catch (error) {
    next(error);
  }
};

export const unhideProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await managerProfilesService.unhideProfile(ctx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
