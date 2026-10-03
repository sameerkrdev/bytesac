import express from "express";
import { createInstrumentRequestSchema, updateInstrumentRequestSchema, createDeploymentRequestSchema, updateDeploymentRequestSchema, feeOnTransferRequestSchema, permissionedRequestSchema, createRouteRequestSchema, updateRouteRequestSchema, createRuleRequestSchema, updateRuleRequestSchema, z, priceKindSchema, putPriceReferenceRequestSchema, navEntryRequestSchema, issuerRequestSchema, updateIssuerRequestSchema, assetProviderRequestSchema, updateAssetProviderRequestSchema, assetDecisionRequestSchema, createAssetTagRequestSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { requireRole } from "@/middlewares/auth.middleware";
import { createAssetProvider, createAssetTag, createDeployment, createInstrument, createIssuer, createRoute, createRule, decideInstrument, getAssetForOps, getAssetPrices, listAssetProviders, listAssetTags, listAssetsForOps, listIssuers, putPriceReference, recordNav, retireAssetTag, setFeeOnTransfer, setPermissioned, submitInstrument, updateAssetProvider, updateDeployment, updateInstrument, updateIssuer, updateRoute, updateRule, verifyDeployment, transitionAssetItem, transitionInstrument } from "./assets.ops.controller";

const idParam = z.object({ id: z.uuid() });

const reviewer = requireRole("ops_reviewer");

const didParam = z.object({ id: z.uuid(), did: z.uuid() });

const ridParam = z.object({ id: z.uuid(), rid: z.uuid() });

const ruleParam = z.object({ id: z.uuid(), ruleId: z.uuid() });

const router: express.Router = express.Router();

router.get("/assets", reviewer, listAssetsForOps);

router.post("/assets", reviewer, validate({ body: createInstrumentRequestSchema }), createInstrument);

router.get("/assets/:id", reviewer, validate({ params: idParam }), getAssetForOps);

router.patch("/assets/:id", reviewer, validate({ params: idParam, body: updateInstrumentRequestSchema }), updateInstrument);

router.post("/assets/:id/deployments", reviewer, validate({ params: idParam, body: createDeploymentRequestSchema }), createDeployment);

router.patch("/assets/:id/deployments/:did", reviewer, validate({ params: didParam, body: updateDeploymentRequestSchema }), updateDeployment);

router.patch("/assets/:id/deployments/:did/fee-on-transfer", requireRole("ops_admin"), validate({ params: didParam, body: feeOnTransferRequestSchema }), setFeeOnTransfer);

/** Spec 11: a permissioned token is never investable. */
router.patch("/assets/:id/deployments/:did/permissioned", requireRole("ops_admin"), validate({ params: didParam, body: permissionedRequestSchema }), setPermissioned);

router.post("/assets/:id/deployments/:did/verify", reviewer, validate({ params: didParam }), verifyDeployment);

router.post("/assets/:id/routes", reviewer, validate({ params: idParam, body: createRouteRequestSchema }), createRoute);

router.patch("/assets/:id/routes/:rid", reviewer, validate({ params: ridParam, body: updateRouteRequestSchema }), updateRoute);

router.post("/assets/:id/rules", reviewer, validate({ params: idParam, body: createRuleRequestSchema }), createRule);

router.patch("/assets/:id/rules/:ruleId", reviewer, validate({ params: ruleParam, body: updateRuleRequestSchema }), updateRule);

router.put("/assets/:id/price-references/:kind", reviewer, validate({ params: z.object({ id: z.uuid(), kind: priceKindSchema }), body: putPriceReferenceRequestSchema }), putPriceReference);

router.post("/assets/:id/nav", reviewer, validate({ params: idParam, body: navEntryRequestSchema }), recordNav);

router.get("/asset-issuers", reviewer, listIssuers);

router.post("/asset-issuers", reviewer, validate({ body: issuerRequestSchema }), createIssuer);

router.patch("/asset-issuers/:id", reviewer, validate({ params: idParam, body: updateIssuerRequestSchema }), updateIssuer);

router.get("/asset-providers", reviewer, listAssetProviders);

router.post("/asset-providers", reviewer, validate({ body: assetProviderRequestSchema }), createAssetProvider);

router.patch("/asset-providers/:id", reviewer, validate({ params: idParam, body: updateAssetProviderRequestSchema }), updateAssetProvider);

router.get("/assets/:id/prices", reviewer, validate({ params: idParam }), getAssetPrices);

router.post("/assets/:id/submit", reviewer, validate({ params: idParam }), submitInstrument);

router.post("/assets/:id/decision", requireRole("ops_admin"), validate({ params: idParam, body: assetDecisionRequestSchema }), decideInstrument);

router.get("/asset-tags", reviewer, listAssetTags);

router.post("/asset-tags", requireRole("ops_admin"), validate({ body: createAssetTagRequestSchema }), createAssetTag);

router.post("/asset-tags/:id/retire", requireRole("ops_admin"), validate({ params: idParam }), retireAssetTag);

for (const action of ["activate", "pause", "resume", "deprecate", "retire"] as const) {
  router.post(`/assets/:id/${action}`, requireRole("ops_admin"), validate({ params: idParam }), transitionInstrument(action));
}

for (const kind of ["deployments", "routes"] as const) {
  for (const action of ["approve", "activate", "pause", "resume", "retire"] as const) {
    router.post(`/assets/:id/${kind}/:itemId/${action}`, requireRole("ops_admin"), validate({ params: z.object({ id: z.uuid(), itemId: z.uuid() }) }), transitionAssetItem(kind, action));
  }
}

export default router;
