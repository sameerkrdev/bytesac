import express from "express";
import { waitlistJoinSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { postWaitlistJoin } from "./waitlist.controller";

const router: express.Router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    await consume(limits.waitlistIp, req.ctx.ip);
    const email = typeof (req.body as { email?: unknown })?.email === "string" ? (req.body as { email: string }).email.trim().toLowerCase() : "";
    if (email) await consume(limits.waitlistEmail, email);
    next();
  } catch (err) {
    next(err);
  }
}, validate({ body: waitlistJoinSchema }), postWaitlistJoin);

export default router;
