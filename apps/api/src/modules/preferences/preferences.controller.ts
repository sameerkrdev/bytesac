import type { NextFunction, Request, Response } from "express";
import type { NotificationPreferences } from "@repo/validator";
import * as preferencesService from "./preferences.service";

export const getPreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await preferencesService.getPreferences(req.auth!.userId));
  } catch (error) {
    next(error);
  }
};

export const updatePreferences = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await preferencesService.updatePreferences(req.auth!, req.ctx.requestId, req.body as NotificationPreferences));
  } catch (error) {
    next(error);
  }
};
