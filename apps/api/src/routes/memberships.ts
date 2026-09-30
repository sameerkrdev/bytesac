import { Router, type Request } from "express";
import { membershipProfileRequestSchema, z, type MembershipProfileRequest } from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { acceptInvitation, declineInvitation, leaveOrganization, updateMembershipProfile } from "../services/members";

const midParam = z.object({ mid: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

/** The caller's own membership: invitations, leaving and the public name. */
export const membershipsRouter = Router();
membershipsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

membershipsRouter.post("/:mid/accept", validate({ params: midParam }), async (req, res) => {
  res.json(await acceptInvitation(ctx(req), req.params.mid as string));
});

membershipsRouter.post("/:mid/decline", validate({ params: midParam }), async (req, res) => {
  res.json(await declineInvitation(ctx(req), req.params.mid as string));
});

membershipsRouter.post("/:mid/leave", validate({ params: midParam }), async (req, res) => {
  res.json(await leaveOrganization(ctx(req), req.params.mid as string));
});

membershipsRouter.patch("/:mid/profile", validate({ params: midParam, body: membershipProfileRequestSchema }), async (req, res) => {
  res.json(await updateMembershipProfile(ctx(req), req.params.mid as string, req.body as MembershipProfileRequest));
});
