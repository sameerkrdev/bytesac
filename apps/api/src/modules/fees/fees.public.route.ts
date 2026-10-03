import express from "express";
import { platformFeeRates } from "./fees.public.controller";

const router: express.Router = express.Router();

/** The default platform fee schedule: the rates before any organization or basket override. */
router.get("/fees", platformFeeRates);

export default router;
