import type { NextFunction, Request, Response } from "express";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as organizationsService from "./organizations.service";

export const getPublicOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.publicProfileIp, req.ctx.ip);
    res.json(await organizationsService.getPublicOrganization(req.params.id as string));
  } catch (error) {
    next(error);
  }
};
