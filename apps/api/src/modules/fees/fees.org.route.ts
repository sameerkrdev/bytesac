import express from "express";
import { z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { getEarnings } from "./fees.org.controller";

const idParam = z.object({ id: z.uuid() });

const router: express.Router = express.Router();

/** Settled manager fees (Owner and Admin: `earnings.read`); `format=csv` downloads one row per settled fee. */
router.get("/:id/earnings", validate({ params: idParam }), getEarnings);

export default router;
