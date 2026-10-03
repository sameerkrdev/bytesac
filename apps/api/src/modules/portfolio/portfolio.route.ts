import express from "express";
import { syncRequestSchema } from "@repo/validator";
import { requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { getPortfolio, syncShortfall } from "./portfolio.controller";

const router: express.Router = express.Router();

router.use(requireSession);

router.get("/", getPortfolio);

router.post("/sync", validate({ body: syncRequestSchema }), syncShortfall);

export default router;
