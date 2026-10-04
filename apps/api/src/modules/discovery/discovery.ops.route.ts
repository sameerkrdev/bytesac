import express from "express";
import { hideManagerProfileRequestSchema, setBasketFeaturedRequestSchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { requireRole } from "@/middlewares/auth.middleware";
import { hideProfile, listProfilesForOps, setFeatured, unhideProfile } from "./discovery.ops.controller";

const idParam = z.object({ id: z.uuid() });

const reviewer = requireRole("ops_reviewer");

const router: express.Router = express.Router();

router.get("/manager-profiles", reviewer, listProfilesForOps);

router.post("/manager-profiles/:id/hide", reviewer, validate({ params: idParam, body: hideManagerProfileRequestSchema }), hideProfile);

router.post("/manager-profiles/:id/unhide", reviewer, validate({ params: idParam }), unhideProfile);

/** Curates the public Featured rail. */
router.put("/baskets/:id/featured", reviewer, validate({ params: idParam, body: setBasketFeaturedRequestSchema }), setFeatured);

export default router;
