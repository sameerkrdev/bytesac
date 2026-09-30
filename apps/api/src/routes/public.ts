import { Router } from "express";
import { z } from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { getPublicOrganization } from "../services/organizations";

/** No session: only the public fields of a verified organization's current approved version. */
export const publicRouter = Router();

publicRouter.get("/organizations/:id", validate({ params: z.object({ id: z.uuid() }) }), async (req, res) => {
  await consume(limits.publicProfileIp, req.ctx.ip);
  res.json(await getPublicOrganization(req.params.id as string));
});
