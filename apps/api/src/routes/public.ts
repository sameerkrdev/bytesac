import { Router } from "express";
import { publicBasketQuerySchema, z } from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { getPublicOrganization } from "../services/organizations";
import { getPublicBasket, listPublicBaskets } from "../services/public-baskets";

/** No session: only the public fields of a verified organization's current approved version. */
export const publicRouter = Router();

publicRouter.get("/organizations/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  await consume(limits.publicProfileIp, req.ctx.ip);
  res.json(await getPublicOrganization(req.params.id as string));
});

publicRouter.get("/baskets", async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  res.json(await listPublicBaskets(publicBasketQuerySchema.parse(req.query)));
});

publicRouter.get("/baskets/:slug", validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90) }) }), async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  res.json(await getPublicBasket(req.params.slug as string));
});
