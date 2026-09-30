import { Router } from "express";
import { assetListQuerySchema, z } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { getPublicAsset, listPublicAssets } from "../services/assets";

/** Read-only view of ACTIVE instruments for signed-in users: public fields and prices only. */
export const assetsRouter = Router();
assetsRouter.use(requireSession);

assetsRouter.get("/", async (req, res) => {
  res.json(await listPublicAssets(assetListQuerySchema.parse(req.query)));
});

assetsRouter.get("/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  res.json(await getPublicAsset(req.params.id as string));
});
