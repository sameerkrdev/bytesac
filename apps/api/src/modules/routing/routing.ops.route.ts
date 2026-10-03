import express from "express";
import { z, routePolicyInputSchema } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { allowTool, denyTool, getLifiTransfers, getRouting } from "./routing.ops.controller";

const idParam = z.object({ id: z.uuid() });

const reviewer = requireRole("ops_reviewer");

const router: express.Router = express.Router();

/** LI.FI's own record of the wallet's transfers around a leg (read-only, ops_admin): an aid for resolving a stuck leg, never evidence. */
router.get("/operations/:id/legs/:legId/lifi-transfers", requireRole("ops_admin"), validate({ params: z.object({ id: z.uuid(), legId: z.uuid() }) }), getLifiTransfers);

// Route policy: LI.FI bridges and exchanges ops keep out of every estimate and quote. Ops roles read; only ops_admin denies or allows.
router.get("/routing", reviewer, getRouting);

router.post("/routing/deny", requireRole("ops_admin"), validate({ body: routePolicyInputSchema }), denyTool);

router.post("/routing/:id/allow", requireRole("ops_admin"), validate({ params: idParam }), allowTool);

export default router;
