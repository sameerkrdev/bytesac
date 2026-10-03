import express from "express";
import { saveBasketDraftRequestSchema, createAssignmentRequestSchema, updateAssignmentRequestSchema, endAssignmentRequestSchema, basketReasonRequestSchema, z } from "@repo/validator";
import { optionalSession, requireSession } from "@/middlewares/auth.middleware";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { addAssignment, createNextVersion, endAssignment, getBasketAdoption, getBasketForMember, getBasketInvestability, getVersionDiff, listVersions, pauseBasket, previewOpenVersion, publishVersion, requestRetirement, resumeBasket, saveDraft, submitVersion, updateAssignment, validateOpenVersion, withdrawVersion } from "./baskets.controller";

const bidParam = z.object({ bid: z.uuid() });

const versionParams = z.object({ bid: z.uuid(), vid: z.uuid() });

const assignmentParams = z.object({ bid: z.uuid(), aid: z.uuid() });

const router: express.Router = express.Router();

/** Session optional: eligibility is only computed for a signed-in user. */
router.get("/:slug/investability", optionalSession, validate({ params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90) }) }), getBasketInvestability);

router.use(requireSession, async (req, _res, next) => {
  if (req.method !== "GET") await consume(limits.basketMutationUser, req.auth!.userId);
  next();
});

router.get("/:bid", validate({ params: bidParam }), getBasketForMember);

/** Aggregate adoption of the published versions: counts only, for members with basket read access. */
router.get("/:bid/adoption", validate({ params: bidParam }), getBasketAdoption);

router.patch("/:bid/draft", validate({ params: bidParam, body: saveBasketDraftRequestSchema }), saveDraft);

router.post("/:bid/validate", validate({ params: bidParam }), validateOpenVersion);

router.get("/:bid/preview", validate({ params: bidParam }), previewOpenVersion);

router.post("/:bid/versions", validate({ params: bidParam }), createNextVersion);

router.get("/:bid/versions", validate({ params: bidParam }), listVersions);

router.get("/:bid/versions/:vid/diff", validate({ params: versionParams }), getVersionDiff);

router.post("/:bid/assignments", validate({ params: bidParam, body: createAssignmentRequestSchema }), addAssignment);

router.patch("/:bid/assignments/:aid", validate({ params: assignmentParams, body: updateAssignmentRequestSchema }), updateAssignment);

router.post("/:bid/assignments/:aid/end", validate({ params: assignmentParams, body: endAssignmentRequestSchema }), endAssignment);

router.post("/:bid/submit", validate({ params: bidParam }), submitVersion);

router.post("/:bid/withdraw", validate({ params: bidParam }), withdrawVersion);

router.post("/:bid/publish", validate({ params: bidParam }), publishVersion);

router.post("/:bid/pause", validate({ params: bidParam, body: basketReasonRequestSchema }), pauseBasket);

router.post("/:bid/resume", validate({ params: bidParam }), resumeBasket);

router.post("/:bid/retirement-request", validate({ params: bidParam, body: basketReasonRequestSchema }), requestRetirement);

export default router;
