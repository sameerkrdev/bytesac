import express from "express";
import { hideManagerProfileRequestSchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { requireRole } from "@/middlewares/auth.middleware";
import { hideProfile, listProfilesForOps, unhideProfile } from "./discovery.ops.controller";

const idParam = z.object({ id: z.uuid() });

const reviewer = requireRole("ops_reviewer");

const router: express.Router = express.Router();

router.get("/manager-profiles", reviewer, listProfilesForOps);

router.post("/manager-profiles/:id/hide", reviewer, validate({ params: idParam, body: hideManagerProfileRequestSchema }), hideProfile);

router.post("/manager-profiles/:id/unhide", reviewer, validate({ params: idParam }), unhideProfile);

export default router;
