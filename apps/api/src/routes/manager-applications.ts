import createHttpError from "http-errors";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  applicationReplySchema, confirmApplicationEmailSchema, createApplicationRequestSchema, z,
  type ApplicationReplyRequest, type ConfirmApplicationEmailRequest, type CreateApplicationRequest,
} from "@repo/validator";
import { consume, limits } from "@/middlewares/rate-limit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { confirmApplicationEmail, createApplication, getApplicationStatus, replyToApplication, resendApplicationCode } from "@/services/applications";

const idParam = z.object({ id: z.uuid() });

/** Public, no session: the applicant proves access with the status token from the confirmation step. */
export const managerApplicationsRouter = Router();

const tokenIpLimit = async (req: Request, _res: Response, next: NextFunction) => {
  await consume(limits.appTokenIp, req.ctx.ip);
  next();
};
const tokenOf = (req: Request): string => {
  const token = req.header("x-application-token");
  if (!token) throw createHttpError("This status link is invalid or has expired.", { code: "APPLICATION_TOKEN_INVALID" });
  return token;
};

managerApplicationsRouter.post("/", validate({ body: createApplicationRequestSchema }), async (req, res) => {
  res.status(201).json(await createApplication(req.ctx, req.body as CreateApplicationRequest));
});

managerApplicationsRouter.post("/:id/confirm-email", validate({ params: idParam, body: confirmApplicationEmailSchema }), async (req, res) => {
  res.json(await confirmApplicationEmail(req.ctx, req.params.id as string, (req.body as ConfirmApplicationEmailRequest).code));
});

managerApplicationsRouter.post("/:id/resend-code", validate({ params: idParam }), async (req, res) => {
  await resendApplicationCode(req.ctx, req.params.id as string);
  res.status(204).end();
});

managerApplicationsRouter.get("/status", tokenIpLimit, async (req, res) => {
  res.json(await getApplicationStatus(tokenOf(req)));
});

managerApplicationsRouter.post("/reply", tokenIpLimit, validate({ body: applicationReplySchema }), async (req, res) => {
  await replyToApplication(req.ctx, tokenOf(req), (req.body as ApplicationReplyRequest).message);
  res.status(204).end();
});
