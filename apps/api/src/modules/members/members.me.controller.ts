import type { NextFunction, Request, Response } from "express";
import * as membersService from "./members.service";

export const listMyInvitations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await membersService.listMyInvitations({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx }));
  } catch (error) {
    next(error);
  }
};
