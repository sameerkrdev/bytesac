import type { NextFunction, Request, Response } from "express";
import * as healthService from "./health.service";

export const getHealth = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { ok, body } = await healthService.checkHealth();
    res.status(ok ? 200 : 503).json(body);
  } catch (error) {
    next(error);
  }
};
