import { addContactRequestSchema, verifyContactRequestSchema } from "@repo/validator";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../../../deps.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { requireSession } from "../../identity/http/require-session.js";
import { contactService } from "../application/contact-service.js";

const idParam = z.object({ id: z.uuid() });

export function contactsRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));
  const ctx = (req: Express.Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

  r.post("/", async (req, res) => {
    const body = parseOrThrow(addContactRequestSchema, req.body);
    res.status(201).json(await contactService.add(deps, { ...ctx(req), type: body.type, rawValue: body.value }));
  });
  r.post("/:id/verify", async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params);
    const { code } = parseOrThrow(verifyContactRequestSchema, req.body);
    res.json(await contactService.verify(deps, { ...ctx(req), contactId: id, code }));
  });
  r.post("/:id/resend", async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params);
    res.json(await contactService.resend(deps, { ...ctx(req), contactId: id }));
  });
  return r;
}
