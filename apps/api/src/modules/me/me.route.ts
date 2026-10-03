import express from "express";
import { requireSession } from "@/middlewares/auth.middleware";
import authMeRouter from "@/modules/auth/auth.me.route";
import discoveryMeRouter from "@/modules/discovery/discovery.me.route";
import eligibilityMeRouter from "@/modules/eligibility/eligibility.me.route";
import membersMeRouter from "@/modules/members/members.me.route";
import notificationsMeRouter from "@/modules/notifications/notifications.me.route";
import { getMe } from "./me.controller";

const router: express.Router = express.Router();

router.use(requireSession);

router.get("/", getMe);

// The routers below carry no session middleware of their own: they are served after requireSession above.
router.use(eligibilityMeRouter, authMeRouter, membersMeRouter, notificationsMeRouter, discoveryMeRouter);

export default router;
