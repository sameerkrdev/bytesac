import express from "express";
import { bitcoinChallengeRequestSchema, bitcoinVerifySchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { listSessions, requestBitcoinChallenge, revokeOwnSession, verifyBitcoinChallenge } from "./auth.controller";

const router: express.Router = express.Router();

/** Bitcoin is link-only (add-chain): a BIP-322 or BIP-137 proof over the challenge message, with the Spec 1 rules (one address per family, not linked elsewhere, session rotation, audit). */
router.post("/chain-accounts/bitcoin/challenge", validate({ body: bitcoinChallengeRequestSchema }), requestBitcoinChallenge);

router.post("/chain-accounts/bitcoin/verify", validate({ body: bitcoinVerifySchema }), verifyBitcoinChallenge);

router.get("/sessions", listSessions);

router.delete("/sessions/:id", validate({ params: z.object({ id: z.uuid() }) }), revokeOwnSession);

export default router;
