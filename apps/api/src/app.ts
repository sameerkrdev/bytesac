import cookieParser from "cookie-parser";
import express, { type Request } from "express";
import morgan from "morgan";
import { logger } from "@repo/logger";
import { env } from "@/config/dotenv";
import { errorHandler, notFoundHandler } from "@/middlewares/error-handler.middleware";
import { requestContext } from "@/middlewares/request-context.middleware";
import { previewGateGuard } from "@/middlewares/preview-gate.middleware";
import { csrfGuard, noCors, rejectDualAuth } from "@/middlewares/security.middleware";
import previewGateRouter from "@/modules/preview-gate/preview-gate.route";
import assetsRouter from "@/modules/assets/assets.route";
import authRouter from "@/modules/auth/auth.route";
import basketsRouter from "@/modules/baskets/baskets.route";
import contactsRouter from "@/modules/contacts/contacts.route";
import healthRouter from "@/modules/health/health.route";
import managerApplicationsRouter from "@/modules/manager-applications/manager-applications.route";
import meRouter from "@/modules/me/me.route";
import membersRouter from "@/modules/members/members.route";
import operationsRouter from "@/modules/operations/operations.route";
import opsRouter from "@/modules/ops/ops.route";
import organizationsRouter from "@/modules/organizations/organizations.route";
import portfolioRouter from "@/modules/portfolio/portfolio.route";
import positionsRouter from "@/modules/portfolio/positions.route";
import preferencesRouter from "@/modules/preferences/preferences.route";
import publicRouter from "@/modules/public/public.route";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContext);
// No :remote-addr or :remote-user: access logs carry the request id, never a full client IP.
// Path only: the query string carries ops search terms (PII).
morgan.token("path", (req) => (req as Request).originalUrl.split("?")[0]);
morgan.token("id", (req) => (req as Request).ctx.requestId);
app.use(morgan(':method :path :status :response-time ms :res[content-length] ":user-agent" :id', { stream: { write: (message) => { logger.http(message.trim()); } } }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(noCors, rejectDualAuth, csrfGuard);
app.use(previewGateGuard);

app.use("/health", healthRouter);
app.use("/v1/preview-gate", previewGateRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/manager-applications", managerApplicationsRouter);
app.use("/v1/me/contacts", contactsRouter);
app.use("/v1/me/notification-preferences", preferencesRouter);
app.use("/v1/me", meRouter);
app.use("/v1/organizations", organizationsRouter);
app.use("/v1/memberships", membersRouter);
app.use("/v1/assets", assetsRouter);
app.use("/v1/baskets", basketsRouter);
app.use("/v1/operations", operationsRouter);
app.use("/v1/portfolio", portfolioRouter);
app.use("/v1/positions", positionsRouter);
app.use("/v1/public", publicRouter);
app.use("/v1/ops", opsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
