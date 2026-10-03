import type { NextFunction, Request, Response } from "express";
import { listNotificationsQuerySchema, z, markReadSchema, pushTokenSchema } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as notificationsService from "./notifications.service";

export const listNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    res.json(await notificationsService.listNotifications(req.auth!.userId, listNotificationsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const markNotificationsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await notificationsService.markRead(req.auth!.userId, req.body as z.infer<typeof markReadSchema>);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const registerPushToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await notificationsService.registerPushToken(req.auth!.userId, req.body as z.infer<typeof pushTokenSchema>);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const revokePushToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.notificationsUser, req.auth!.userId);
    await notificationsService.revokePushToken(req.auth!.userId, (req.body as { token: string }).token);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
