import type { NextFunction, Request, Response } from "express";
import { assetListQuerySchema } from "@repo/validator";
import * as assetsService from "./assets.service";

export const listPublicAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.listPublicAssets(assetListQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const getPublicAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.getPublicAsset(req.params.id as string));
  } catch (error) {
    next(error);
  }
};
