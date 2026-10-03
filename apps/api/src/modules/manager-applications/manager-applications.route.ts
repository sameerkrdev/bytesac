import express, { type NextFunction, type Request, type Response } from "express";
import { createApplicationRequestSchema, confirmApplicationEmailSchema, applicationReplySchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { confirmApplicationEmail, createApplication, getApplicationStatus, replyToApplication, resendApplicationCode } from "./manager-applications.controller";

const idParam = z.object({ id: z.uuid() });

const tokenIpLimit = async (req: Request, _res: Response, next: NextFunction) => {
  await consume(limits.appTokenIp, req.ctx.ip);
  next();
};

const router: express.Router = express.Router();

router.post("/", validate({ body: createApplicationRequestSchema }), createApplication);

router.post("/:id/confirm-email", validate({ params: idParam, body: confirmApplicationEmailSchema }), confirmApplicationEmail);

router.post("/:id/resend-code", validate({ params: idParam }), resendApplicationCode);

router.get("/status", tokenIpLimit, getApplicationStatus);

router.post("/reply", tokenIpLimit, validate({ body: applicationReplySchema }), replyToApplication);

export default router;
