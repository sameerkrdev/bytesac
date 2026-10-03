import express from "express";
import { z } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { getPublicAsset, listPublicAssets } from "./assets.controller";

const router: express.Router = express.Router();

router.use(requireSession);

router.get("/", listPublicAssets);

router.get("/:id", validate({ params: z.object({ id: z.uuid() }) }), getPublicAsset);

export default router;
