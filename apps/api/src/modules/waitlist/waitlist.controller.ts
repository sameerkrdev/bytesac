import type { NextFunction, Request, Response } from "express";
import type { WaitlistEmailJoinRequest, WaitlistJoinRequest } from "@repo/validator";
import { joinWaitlist, joinWaitlistByEmail } from "./waitlist.service";

export async function postWaitlistJoin(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await joinWaitlist(req.body as WaitlistJoinRequest));
  } catch (err) {
    next(err);
  }
}

export async function postWaitlistEmailJoin(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await joinWaitlistByEmail(req.body as WaitlistEmailJoinRequest));
  } catch (err) {
    next(err);
  }
}
