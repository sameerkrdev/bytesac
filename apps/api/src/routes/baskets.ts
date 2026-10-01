import { db } from "@repo/db";
import { Router, type Request } from "express";
import {
  basketReasonRequestSchema, createAssignmentRequestSchema, endAssignmentRequestSchema, saveBasketDraftRequestSchema, updateAssignmentRequestSchema, z,
  type BasketReasonRequest, type Investability, type CreateAssignmentRequest, type EndAssignmentRequest, type SaveBasketDraftRequest, type UpdateAssignmentRequest,
} from "@repo/validator";
import { optionalSession, requireSession } from "../middleware/auth";
import { consume, limits } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { getInvestability } from "../services/investability";
import {
  addAssignment, createNextVersion, endAssignment, getBasketForMember, getVersionDiff, listVersions, previewOpenVersion, saveDraft, updateAssignment, validateOpenVersion,
} from "../services/baskets";
import { pauseBasket, publishVersion, requestRetirement, resumeBasket, submitVersion, withdrawVersion } from "../services/basket-review";

const bidParam = z.object({ bid: z.uuid() });
const versionParams = z.object({ bid: z.uuid(), vid: z.uuid() });
const assignmentParams = z.object({ bid: z.uuid(), aid: z.uuid() });
const ctx = (req: Request) => ({ userId: req.auth!.userId, sessionId: req.auth!.sessionId, meta: req.ctx });

/** Manager routes: every action is authorized per basket in the service (assignment flags), never here. */
export const basketsRouter = Router();
/** Session optional: eligibility is only computed for a signed-in user. */
basketsRouter.get("/:slug/investability", optionalSession, validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90) }) }), async (req, res) => {
  await consume(limits.publicBasketIp, req.ctx.ip);
  const { investable, reasons, requiredFamilies, minimumUsdc, eligibility } = await getInvestability(db, { slug: req.params.slug as string }, req.auth?.userId ?? null);
  const body: Investability = { investable, reasons, requiredFamilies, minimumUsdc, eligibility };
  res.json(body);
});

basketsRouter.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.basketMutationUser, req.auth!.userId);
  next();
});

basketsRouter.get("/:bid", validate({ params: bidParam }), async (req, res) => {
  res.json(await getBasketForMember(ctx(req), req.params.bid as string));
});

basketsRouter.patch("/:bid/draft", validate({ params: bidParam, body: saveBasketDraftRequestSchema }), async (req, res) => {
  res.json(await saveDraft(ctx(req), req.params.bid as string, req.body as SaveBasketDraftRequest));
});

basketsRouter.post("/:bid/validate", validate({ params: bidParam }), async (req, res) => {
  res.json(await validateOpenVersion(ctx(req), req.params.bid as string));
});

basketsRouter.get("/:bid/preview", validate({ params: bidParam }), async (req, res) => {
  res.json(await previewOpenVersion(ctx(req), req.params.bid as string));
});

basketsRouter.post("/:bid/versions", validate({ params: bidParam }), async (req, res) => {
  res.status(201).json(await createNextVersion(ctx(req), req.params.bid as string));
});

basketsRouter.get("/:bid/versions", validate({ params: bidParam }), async (req, res) => {
  res.json(await listVersions(ctx(req), req.params.bid as string));
});

basketsRouter.get("/:bid/versions/:vid/diff", validate({ params: versionParams }), async (req, res) => {
  res.json(await getVersionDiff(ctx(req), req.params.bid as string, req.params.vid as string));
});

basketsRouter.post("/:bid/assignments", validate({ params: bidParam, body: createAssignmentRequestSchema }), async (req, res) => {
  res.status(201).json(await addAssignment(ctx(req), req.params.bid as string, req.body as CreateAssignmentRequest));
});

basketsRouter.patch("/:bid/assignments/:aid", validate({ params: assignmentParams, body: updateAssignmentRequestSchema }), async (req, res) => {
  res.json(await updateAssignment(ctx(req), req.params.bid as string, req.params.aid as string, req.body as UpdateAssignmentRequest));
});

basketsRouter.post("/:bid/assignments/:aid/end", validate({ params: assignmentParams, body: endAssignmentRequestSchema }), async (req, res) => {
  res.json(await endAssignment(ctx(req), req.params.bid as string, req.params.aid as string, req.body as EndAssignmentRequest));
});

basketsRouter.post("/:bid/submit", validate({ params: bidParam }), async (req, res) => {
  res.json(await submitVersion(ctx(req), req.params.bid as string));
});

basketsRouter.post("/:bid/withdraw", validate({ params: bidParam }), async (req, res) => {
  res.json(await withdrawVersion(ctx(req), req.params.bid as string));
});

basketsRouter.post("/:bid/publish", validate({ params: bidParam }), async (req, res) => {
  res.json(await publishVersion(ctx(req), req.params.bid as string));
});

basketsRouter.post("/:bid/pause", validate({ params: bidParam, body: basketReasonRequestSchema }), async (req, res) => {
  res.json(await pauseBasket(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
});

basketsRouter.post("/:bid/resume", validate({ params: bidParam }), async (req, res) => {
  res.json(await resumeBasket(ctx(req), req.params.bid as string));
});

basketsRouter.post("/:bid/retirement-request", validate({ params: bidParam, body: basketReasonRequestSchema }), async (req, res) => {
  res.json(await requestRetirement(ctx(req), req.params.bid as string, (req.body as BasketReasonRequest).reason));
});
