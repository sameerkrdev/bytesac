import type { NextFunction, Request, Response } from "express";
import * as meService from "./me.service";

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await meService.getMe(req.auth!.userId));
  } catch (error) {
    next(error);
  }
};
