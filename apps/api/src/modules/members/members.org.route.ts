import express from "express";
import { inviteMemberRequestSchema, changeRoleRequestSchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { cancelInvite, cancelRemoval, changeRole, confirmRemoval, inviteMember, listMembers, removeMember } from "./members.org.controller";

const idParam = z.object({ id: z.uuid() });

const memberParams = z.object({ id: z.uuid(), mid: z.uuid() });

const router: express.Router = express.Router();

router.get("/:id/members", validate({ params: idParam }), listMembers);

router.post("/:id/members/invitations", validate({ params: idParam, body: inviteMemberRequestSchema }), inviteMember);

router.post("/:id/members/:mid/cancel", validate({ params: memberParams }), cancelInvite);

router.post("/:id/members/:mid/role", validate({ params: memberParams, body: changeRoleRequestSchema }), changeRole);

router.post("/:id/members/:mid/remove", validate({ params: memberParams }), removeMember);

router.post("/:id/members/:mid/removal/confirm", validate({ params: memberParams }), confirmRemoval);

router.post("/:id/members/:mid/removal/cancel", validate({ params: memberParams }), cancelRemoval);

export default router;
