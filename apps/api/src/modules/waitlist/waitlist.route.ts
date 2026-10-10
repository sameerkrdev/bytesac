import express from "express";
import { waitlistEmailJoinSchema, waitlistJoinSchema } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { postWaitlistEmailJoin, postWaitlistJoin } from "./waitlist.controller";

const router: express.Router = express.Router();

const rateLimit: express.RequestHandler = async (req, _res, next) => {
  try {
    await consume(limits.waitlistIp, req.ctx.ip);
    const email = typeof (req.body as { email?: unknown })?.email === "string" ? (req.body as { email: string }).email.trim().toLowerCase() : "";
    if (email) await consume(limits.waitlistEmail, email);
    next();
  } catch (err) {
    next(err);
  }
};

router.post("/", rateLimit, validate({ body: waitlistJoinSchema }), postWaitlistJoin);
router.post("/email", rateLimit, validate({ body: waitlistEmailJoinSchema }), postWaitlistEmailJoin);

export default router;
