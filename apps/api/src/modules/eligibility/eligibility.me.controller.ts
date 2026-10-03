import type { NextFunction, Request, Response } from "express";
import { db } from "@repo/db";
import type { EligibilityDeclarationInput } from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import * as eligibilityService from "@/services/eligibility";

export const currentDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await eligibilityService.currentDeclaration(db, req.auth!.userId));
  } catch (error) {
    next(error);
  }
};

export const declare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await consume(limits.eligibilityUser, req.auth!.userId);
    res.status(201).json(await eligibilityService.declare({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx }, req.body as EligibilityDeclarationInput));
  } catch (error) {
    next(error);
  }
};
