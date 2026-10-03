import express from "express";
import basketsPublicRouter from "@/modules/baskets/baskets.public.route";
import discoveryPublicRouter from "@/modules/discovery/discovery.public.route";
import feesPublicRouter from "@/modules/fees/fees.public.route";
import organizationsPublicRouter from "@/modules/organizations/organizations.public.route";

/** No session: only public fields. Each feature owns its public routes; this router only composes them. */
const router: express.Router = express.Router();

router.use(organizationsPublicRouter, feesPublicRouter, basketsPublicRouter, discoveryPublicRouter);

export default router;
