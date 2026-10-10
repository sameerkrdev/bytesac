import express from "express";
import { previewGateLoginSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { loginPreviewGate, logoutPreviewGate } from "./preview-gate.controller";

const router: express.Router = express.Router();

router.post("/login", async (req, res, next) => {
  try {
    await consume(limits.previewGateIp, req.ctx.ip);
    next();
  } catch (err) {
    next(err);
  }
}, validate({ body: previewGateLoginSchema }), loginPreviewGate);

router.post("/logout", logoutPreviewGate);

export default router;
