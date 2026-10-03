import express from "express";
import { z, resolveLegRequestSchema } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { resolveLeg } from "./operations.ops.controller";

const router: express.Router = express.Router();

/** A leg stuck UNKNOWN: ops settle or fail it from on-chain evidence (verified server-side where possible), audited. */
router.post("/operations/:id/legs/:legId/resolve", requireRole("ops_admin"), validate({ params: z.object({ id: z.uuid(), legId: z.uuid() }), body: resolveLegRequestSchema }), resolveLeg);

export default router;
