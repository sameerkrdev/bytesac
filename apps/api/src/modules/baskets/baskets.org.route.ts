import express from "express";
import { createBasketRequestSchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { createBasket, listOrgBaskets } from "./baskets.org.controller";

const idParam = z.object({ id: z.uuid() });

const router: express.Router = express.Router();

router.post("/:id/baskets", validate({ params: idParam, body: createBasketRequestSchema }), createBasket);

router.get("/:id/baskets", validate({ params: idParam }), listOrgBaskets);

export default router;
