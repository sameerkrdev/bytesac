import express from "express";
import { transitionApplicationRequestSchema, applicationNoteRequestSchema, grantRoleRequestSchema, z } from "@repo/validator";
import { requireRole } from "@/middlewares/auth.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { addApplicationNote, getApplicationDetail, grantRole, listApplications, listRoles, revokeRole, transitionApplication } from "./manager-applications.ops.controller";

const idParam = z.object({ id: z.uuid() });

const router: express.Router = express.Router();

router.get("/applications", requireRole("ops_reviewer"), listApplications);

router.get("/applications/:id", requireRole("ops_reviewer"), validate({ params: idParam }), getApplicationDetail);

router.post("/applications/:id/transition", requireRole("ops_reviewer"), validate({ params: idParam, body: transitionApplicationRequestSchema }), transitionApplication);

router.post("/applications/:id/notes", requireRole("ops_reviewer"), validate({ params: idParam, body: applicationNoteRequestSchema }), addApplicationNote);

router.get("/roles", requireRole("ops_admin"), listRoles);

router.post("/roles", requireRole("ops_admin"), validate({ body: grantRoleRequestSchema }), grantRole);

router.delete("/roles/:id", requireRole("ops_admin"), validate({ params: idParam }), revokeRole);

export default router;
