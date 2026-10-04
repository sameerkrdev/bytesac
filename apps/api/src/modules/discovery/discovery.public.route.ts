import express from "express";
import { aiSearchRequestSchema, managerHandleParamSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { aiSearch, getCollections, getPublicManager, structuredSearch } from "./discovery.public.controller";

const router: express.Router = express.Router();

/** Filters travel as one `f` param: base64url JSON of DiscoveryFilters (unknown keys dropped). */
router.get("/discovery/baskets", structuredSearch);

/** Featured and trending rails (home, discovery). */
router.get("/discovery/collections", getCollections);

router.post("/discovery/ai-search", validate({ body: aiSearchRequestSchema }), aiSearch);

router.get("/managers/:handle", validate({ params: managerHandleParamSchema }), getPublicManager);

export default router;
