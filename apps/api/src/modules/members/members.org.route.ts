import express from "express";
import { assignCustomRoleRequestSchema, createCustomRoleRequestSchema, inviteMemberRequestSchema, changeRoleRequestSchema, updateCustomRoleRequestSchema, z } from "@repo/validator";
import { validate } from "@/middlewares/validate.middleware";
import { archiveRole, assignRole, createRole, listRoles, updateRole, cancelInvite, cancelRemoval, changeRole, confirmRemoval, inviteMember, listMembers, removeMember } from "./members.org.controller";

const idParam = z.object({ id: z.uuid() });

const memberParams = z.object({ id: z.uuid(), mid: z.uuid() });

const router: express.Router = express.Router();

router.get("/:id/members", validate({ params: idParam }), listMembers);

/** Custom roles (ADR-019): any member reads them; only the owner defines them; members.manage assigns them. */
router.get("/:id/roles", validate({ params: idParam }), listRoles);

router.post("/:id/roles", validate({ params: idParam, body: createCustomRoleRequestSchema }), createRole);

router.patch("/:id/roles/:rid", validate({ params: z.object({ id: z.uuid(), rid: z.uuid() }), body: updateCustomRoleRequestSchema }), updateRole);

router.post("/:id/roles/:rid/archive", validate({ params: z.object({ id: z.uuid(), rid: z.uuid() }) }), archiveRole);

router.put("/:id/members/:mid/custom-role", validate({ params: memberParams, body: assignCustomRoleRequestSchema }), assignRole);

router.post("/:id/members/invitations", validate({ params: idParam, body: inviteMemberRequestSchema }), inviteMember);

router.post("/:id/members/:mid/cancel", validate({ params: memberParams }), cancelInvite);

router.post("/:id/members/:mid/role", validate({ params: memberParams, body: changeRoleRequestSchema }), changeRole);

router.post("/:id/members/:mid/remove", validate({ params: memberParams }), removeMember);

router.post("/:id/members/:mid/removal/confirm", validate({ params: memberParams }), confirmRemoval);

router.post("/:id/members/:mid/removal/cancel", validate({ params: memberParams }), cancelRemoval);

export default router;
