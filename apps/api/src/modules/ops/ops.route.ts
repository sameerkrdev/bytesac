import express from "express";
import assetsOpsRouter from "@/modules/assets/assets.ops.route";
import basketsOpsRouter from "@/modules/baskets/baskets.ops.route";
import discoveryOpsRouter from "@/modules/discovery/discovery.ops.route";
import feesOpsRouter from "@/modules/fees/fees.ops.route";
import applicationsOpsRouter from "@/modules/manager-applications/manager-applications.ops.route";
import membersOpsRouter from "@/modules/members/members.ops.route";
import operationsOpsRouter from "@/modules/operations/operations.ops.route";
import organizationsOpsRouter from "@/modules/organizations/organizations.ops.route";
import routingOpsRouter from "@/modules/routing/routing.ops.route";
import { requireSession } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";

const router: express.Router = express.Router();

router.use(requireSession, async (req, _res, next) => {
  await consume(limits.opsUser, req.auth!.userId);
  next();
});

// Every router below declares its own role guard per route; the session and rate limit above cover them all.
router.use(applicationsOpsRouter, organizationsOpsRouter, membersOpsRouter, assetsOpsRouter, basketsOpsRouter, discoveryOpsRouter, operationsOpsRouter, routingOpsRouter, feesOpsRouter);

export default router;
