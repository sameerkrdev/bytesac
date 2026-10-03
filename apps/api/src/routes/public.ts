import { Router } from "express";
import createHttpError from "http-errors";
import { aiSearchRequestSchema, discoveryFiltersSchema, discoveryQuerySchema, managerHandleParamSchema, publicBasketQuerySchema, z } from "@repo/validator";
import { optionalSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { aiSearch, structuredSearch } from "../services/discovery";
import { getPublicManager } from "../services/manager-profiles";
import { getPublicOrganization } from "../services/organizations";
import { getPublicBasket, listPublicBaskets, platformFeeRates } from "../services/public-baskets";

/** No session: only the public fields of a verified organization's current approved version. */
export const publicRouter = Router();

publicRouter.get("/organizations/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  await consume(limits.publicProfileIp, req.ctx.ip);
  res.json(await getPublicOrganization(req.params.id as string));
});

/** The default platform fee schedule: the rates before any organization or basket override. */
publicRouter.get("/fees", async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  res.json({ platform: await platformFeeRates(null, null) });
});

publicRouter.get("/baskets", async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  res.json(await listPublicBaskets(publicBasketQuerySchema.parse(req.query)));
});

publicRouter.get("/baskets/:slug", optionalSession, validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90) }) }), async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  res.json(await getPublicBasket(req.params.slug as string, req.auth ? { userId: req.auth.userId, ipCountry: req.ctx.ipCountry } : null));
});

/** Filters travel as one `f` param: base64url JSON of DiscoveryFilters (unknown keys dropped). */
publicRouter.get("/discovery/baskets", async (req, res) => {
  await consume(limits.discoveryIp, req.ctx.ip);
  const q = discoveryQuerySchema.parse(req.query);
  let raw: unknown = {};
  try {
    if (q.f) raw = JSON.parse(Buffer.from(q.f, "base64url").toString());
  } catch {
    throw createHttpError("Invalid filters", { code: "VALIDATION_FAILED" });
  }
  res.json(await structuredSearch({ ...discoveryFiltersSchema.parse(raw), cursor: q.cursor }));
});

publicRouter.post("/discovery/ai-search", validate({ body: aiSearchRequestSchema }), async (req, res) => {
  await consume(limits.aiSearchIp, req.ctx.ip);
  await consume(limits.aiSearchIpDay, req.ctx.ip);
  await consume(limits.aiSearchGlobalDay, "global");
  res.json(await aiSearch(req.body.query));
});

publicRouter.get("/managers/:handle", validate({ params: managerHandleParamSchema }), async (req, res) => {
  await consume(limits.discoveryIp, req.ctx.ip);
  res.json(await getPublicManager(req.params.handle as string));
});
