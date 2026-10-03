import type { NextFunction, Request, Response } from "express";
import { earningsQuerySchema } from "@repo/validator";
import * as feesService from "./fees.service";

export const getEarnings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = earningsQuerySchema.parse(req.query);
    if (q.format === "csv") res.type("text/csv").attachment("earnings.csv").send(await feesService.getEarningsCsv(req.auth!.userId, req.params.id as string, q));
    else res.json(await feesService.getEarnings(req.auth!.userId, req.params.id as string, q));
  } catch (error) {
    next(error);
  }
};
