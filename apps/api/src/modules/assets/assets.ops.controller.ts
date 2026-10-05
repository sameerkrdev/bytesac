import type { NextFunction, Request, Response } from "express";
import { opsAssetListQuerySchema, type CreateInstrumentRequest, type UpdateInstrumentRequest, type CreateDeploymentRequest, type UpdateDeploymentRequest, type FeeOnTransferRequest, type PermissionedRequest, type CreateRouteRequest, type UpdateRouteRequest, type CreateRuleRequest, type UpdateRuleRequest, type PutPriceReferenceRequest, type NavEntryRequest, type IssuerRequest, type UpdateIssuerRequest, type AssetProviderRequest, type UpdateAssetProviderRequest, type AssetDecisionRequest, type CreateAssetTagRequest, type PresignLogoRequest } from "@repo/validator";
import * as assetsService from "./assets.service";
import * as assetReviewService from "./asset-review.service";
import { opsCtx } from "@/middlewares/request-context.middleware";


export const listAssetsForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.listAssetsForOps(opsAssetListQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
};

export const createInstrument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createInstrument(opsCtx(req), req.body as CreateInstrumentRequest));
  } catch (error) {
    next(error);
  }
};

export const getAssetForOps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.getAssetForOps(req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const updateInstrument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateInstrument(opsCtx(req), req.params.id as string, req.body as UpdateInstrumentRequest));
  } catch (error) {
    next(error);
  }
};

export const createDeployment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createDeployment(opsCtx(req), req.params.id as string, req.body as CreateDeploymentRequest));
  } catch (error) {
    next(error);
  }
};

export const updateDeployment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateDeployment(opsCtx(req), req.params.id as string, req.params.did as string, req.body as UpdateDeploymentRequest));
  } catch (error) {
    next(error);
  }
};

export const setFeeOnTransfer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.setDeploymentFlag(opsCtx(req), req.params.id as string, req.params.did as string, "feeOnTransfer", (req.body as FeeOnTransferRequest).feeOnTransfer));
  } catch (error) {
    next(error);
  }
};

export const setPermissioned = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.setDeploymentFlag(opsCtx(req), req.params.id as string, req.params.did as string, "permissioned", (req.body as PermissionedRequest).permissioned));
  } catch (error) {
    next(error);
  }
};

export const verifyDeployment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.verifyDeployment(opsCtx(req), req.params.id as string, req.params.did as string));
  } catch (error) {
    next(error);
  }
};

export const createRoute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createRoute(opsCtx(req), req.params.id as string, req.body as CreateRouteRequest));
  } catch (error) {
    next(error);
  }
};

export const updateRoute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateRoute(opsCtx(req), req.params.id as string, req.params.rid as string, req.body as UpdateRouteRequest));
  } catch (error) {
    next(error);
  }
};

export const createRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createRule(opsCtx(req), req.params.id as string, req.body as CreateRuleRequest));
  } catch (error) {
    next(error);
  }
};

export const updateRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateRule(opsCtx(req), req.params.id as string, req.params.ruleId as string, req.body as UpdateRuleRequest));
  } catch (error) {
    next(error);
  }
};

export const putPriceReference = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.putPriceReference(opsCtx(req), req.params.id as string, req.params.kind as "market" | "nav", req.body as PutPriceReferenceRequest));
  } catch (error) {
    next(error);
  }
};

export const recordNav = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.recordNav(opsCtx(req), req.params.id as string, req.body as NavEntryRequest));
  } catch (error) {
    next(error);
  }
};

export const listIssuers = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.listIssuers());
  } catch (error) {
    next(error);
  }
};

export const createIssuer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createIssuer(opsCtx(req), req.body as IssuerRequest));
  } catch (error) {
    next(error);
  }
};

export const updateIssuer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateIssuer(opsCtx(req), req.params.id as string, req.body as UpdateIssuerRequest));
  } catch (error) {
    next(error);
  }
};

export const listAssetProviders = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.listAssetProviders());
  } catch (error) {
    next(error);
  }
};

export const createAssetProvider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createAssetProvider(opsCtx(req), req.body as AssetProviderRequest));
  } catch (error) {
    next(error);
  }
};

export const updateAssetProvider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.updateAssetProvider(opsCtx(req), req.params.id as string, req.body as UpdateAssetProviderRequest));
  } catch (error) {
    next(error);
  }
};

export const getAssetPrices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json((await assetsService.getAssetForOps(req.params.id as string)).prices);
  } catch (error) {
    next(error);
  }
};

export const submitInstrument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetReviewService.submitInstrument(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

export const decideInstrument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetReviewService.decideInstrument(opsCtx(req), req.params.id as string, req.body as AssetDecisionRequest));
  } catch (error) {
    next(error);
  }
};

export const listAssetTags = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.listAssetTags());
  } catch (error) {
    next(error);
  }
};

export const createAssetTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.createAssetTag(opsCtx(req), req.body as CreateAssetTagRequest));
  } catch (error) {
    next(error);
  }
};

export const retireAssetTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.retireAssetTag(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};

type InstrumentAction = Parameters<typeof assetReviewService.transitionInstrument>[2];
type AssetItemKind = Parameters<typeof assetReviewService.transitionAssetItem>[2];
type AssetItemAction = Parameters<typeof assetReviewService.transitionAssetItem>[4];

export const transitionInstrument = (action: InstrumentAction) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetReviewService.transitionInstrument(opsCtx(req), req.params.id as string, action));
  } catch (error) {
    next(error);
  }
};

export const transitionAssetItem = (kind: AssetItemKind, action: AssetItemAction) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetReviewService.transitionAssetItem(opsCtx(req), req.params.id as string, kind, req.params.itemId as string, action));
  } catch (error) {
    next(error);
  }
};

export const presignInstrumentLogo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await assetsService.presignInstrumentLogo(opsCtx(req), req.params.id as string, req.body as PresignLogoRequest));
  } catch (error) {
    next(error);
  }
};

export const confirmInstrumentLogo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.confirmInstrumentLogo(opsCtx(req), req.params.id as string, req.params.fileId as string));
  } catch (error) {
    next(error);
  }
};

export const removeInstrumentLogo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await assetsService.removeInstrumentLogo(opsCtx(req), req.params.id as string));
  } catch (error) {
    next(error);
  }
};
