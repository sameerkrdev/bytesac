import express from "express";
import { z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { getPublicOrganization } from "./organizations.public.controller";

const router: express.Router = express.Router();

router.get("/organizations/:id", validate({ params: z.object({ id: z.uuid() }) }), getPublicOrganization);

export default router;
