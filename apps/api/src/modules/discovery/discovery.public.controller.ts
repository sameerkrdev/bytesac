import type { NextFunction, Request, Response } from "express";
import { discoveryQuerySchema, discoveryFiltersSchema } from "@repo/validator";
import createHttpError from "http-errors";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as discoveryService from "./discovery.service";
import * as managerProfilesService from "./manager-profiles.service";

export const structuredSearch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.discoveryIp, req.ctx.ip);
    const q = discoveryQuerySchema.parse(req.query);
    let raw: unknown = {};
    try {
      if (q.f) raw = JSON.parse(Buffer.from(q.f, "base64url").toString());
    } catch {
      throw createHttpError("Invalid filters", { code: "VALIDATION_FAILED" });
    }
    res.json(await discoveryService.structuredSearch({ ...discoveryFiltersSchema.parse(raw), cursor: q.cursor }));
  } catch (error) {
    next(error);
  }
};

export const aiSearch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.aiSearchIp, req.ctx.ip);
    await consume(limits.aiSearchIpDay, req.ctx.ip);
    await consume(limits.aiSearchGlobalDay, "global");
    res.json(await discoveryService.aiSearch(req.body.query));
  } catch (error) {
    next(error);
  }
};

export const getPublicManager = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.discoveryIp, req.ctx.ip);
    res.json(await managerProfilesService.getPublicManager(req.params.handle as string));
  } catch (error) {
    next(error);
  }
};
