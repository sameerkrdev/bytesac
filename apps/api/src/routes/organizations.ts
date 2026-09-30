import { Router, type Request } from "express";
import {
  createOrganizationRequestSchema, presignDocumentRequestSchema, updateDraftRequestSchema, z,
  type CreateOrganizationRequest, type PresignDocumentRequest, type UpdateDraftRequest,
} from "@repo/validator";
import { requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  confirmDocument, createOrganization, getOrganizationForOwner, listMyOrganizations, presignDocument, unlinkDocument, updateDraft,
} from "../services/organizations";

const idParam = z.object({ id: z.uuid() });
const docParams = z.object({ id: z.uuid(), docId: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

export const organizationsRouter = Router();
organizationsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.ownerMutationUser, req.auth!.userId);
  next();
});

organizationsRouter.post("/", validate({ body: createOrganizationRequestSchema }), async (req, res) => {
  res.status(201).json(await createOrganization(ctx(req), req.body as CreateOrganizationRequest));
});

organizationsRouter.get("/mine", async (req, res) => {
  res.json(await listMyOrganizations(req.auth!.userId));
});

organizationsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json(await getOrganizationForOwner(ctx(req), req.params.id as string));
});

organizationsRouter.patch("/:id/draft", validate({ params: idParam, body: updateDraftRequestSchema }), async (req, res) => {
  res.json(await updateDraft(ctx(req), req.params.id as string, req.body as UpdateDraftRequest));
});

organizationsRouter.post("/:id/documents", validate({ params: idParam, body: presignDocumentRequestSchema }), async (req, res) => {
  res.status(201).json(await presignDocument(ctx(req), req.params.id as string, req.body as PresignDocumentRequest));
});

organizationsRouter.post("/:id/documents/:docId/confirm", validate({ params: docParams }), async (req, res) => {
  res.json(await confirmDocument(ctx(req), req.params.id as string, req.params.docId as string));
});

organizationsRouter.delete("/:id/draft/documents/:docId", validate({ params: docParams }), async (req, res) => {
  res.json(await unlinkDocument(ctx(req), req.params.id as string, req.params.docId as string));
});
