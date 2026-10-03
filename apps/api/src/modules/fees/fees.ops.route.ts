import express from "express";
import { platformFeeScheduleInputSchema, platformFeeOverrideInputSchema, z } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { endOverride, getRevenue, listOverrides, listSchedules, saveOverride, saveSchedule } from "./fees.ops.controller";

const idParam = z.object({ id: z.uuid() });

const reviewer = requireRole("ops_reviewer");

const router: express.Router = express.Router();

// Platform fee schedules: the default per operation type, and organization / basket overrides. Reviewers read; only ops_admin changes them.
router.get("/fees", reviewer, listSchedules);

router.post("/fees", requireRole("ops_admin"), validate({ body: platformFeeScheduleInputSchema }), saveSchedule);

router.get("/fees/overrides", reviewer, listOverrides);

router.post("/fees/overrides", requireRole("ops_admin"), validate({ body: platformFeeOverrideInputSchema }), saveOverride);

router.post("/fees/overrides/:id/end", requireRole("ops_admin"), validate({ params: idParam }), endOverride);

/** Platform revenue from settled fees (and waived manager fees by reason); `format=csv` downloads one row per settled fee. */
router.get("/revenue", reviewer, getRevenue);

export default router;
