import express from "express";
import { z, skipRequestSchema } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { closeDustPosition, keepCustom, leavePosition, revertCustom, skipVersion } from "./positions.controller";

const positionParam = validate({ params: z.object({ id: z.uuid() }) });

const router: express.Router = express.Router();

router.use(requireSession);

router.post("/:id/skip", validate({ params: z.object({ id: z.uuid() }), body: skipRequestSchema }), skipVersion);

router.post("/:id/custom", positionParam, keepCustom);

router.post("/:id/custom/revert", positionParam, revertCustom);

router.post("/:id/close", positionParam, closeDustPosition);

router.post("/:id/leave", validate({ params: z.object({ id: z.uuid() }) }), leavePosition);

export default router;
