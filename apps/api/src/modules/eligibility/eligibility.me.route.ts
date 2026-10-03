import express from "express";
import { eligibilityDeclarationInputSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { currentDeclaration, declare } from "./eligibility.me.controller";

const router: express.Router = express.Router();

/** Spec 11: the self-declared country and investor status that tokenized-asset eligibility rests on (append-only; the latest row is current for 365 days). */
router.get("/eligibility", currentDeclaration);

router.post("/eligibility", validate({ body: eligibilityDeclarationInputSchema }), declare);

export default router;
