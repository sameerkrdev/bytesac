import express from "express";
import { challengeRequestSchema, verifyRequestSchema } from "@repo/validator";
import { optionalSession, requireSession } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { logout, logoutAll, reassignChainHandler, requestChallenge, verifySignature } from "./auth.controller";

const router: express.Router = express.Router();

router.post("/challenge", optionalSession, validate({ body: challengeRequestSchema }), requestChallenge);

router.post("/verify", optionalSession, validate({ body: verifyRequestSchema }), verifySignature);

router.post("/reassign", requireSession, validate({ body: verifyRequestSchema }), reassignChainHandler);

router.post("/logout", requireSession, logout);

router.post("/logout-all", requireSession, logoutAll);

export default router;
