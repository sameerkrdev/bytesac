import type { NextFunction, Request, Response } from "express";
import type { WaitlistJoinRequest } from "@repo/validator";
import { joinWaitlist } from "./waitlist.service";

export async function postWaitlistJoin(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await joinWaitlist(req.body as WaitlistJoinRequest));
  } catch (err) {
    next(err);
  }
}
