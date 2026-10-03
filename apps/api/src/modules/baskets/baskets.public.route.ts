import express from "express";
import { z } from "@repo/validator";
import { optionalSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { getPublicBasket, listPublicBaskets } from "./baskets.public.controller";

const router: express.Router = express.Router();

router.get("/baskets", listPublicBaskets);

router.get("/baskets/:slug", optionalSession, validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90) }) }), getPublicBasket);

export default router;
