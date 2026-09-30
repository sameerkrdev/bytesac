import cookieParser from "cookie-parser";
import express, { type Request } from "express";
import morgan from "morgan";
import { logger } from "@repo/logger";
import { env } from "./env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import { csrfGuard, noCors, rejectDualAuth } from "./middleware/security";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { healthRouter } from "./routes/health";
import { managerApplicationsRouter } from "./routes/manager-applications";
import { meRouter } from "./routes/me";
import { membershipsRouter } from "./routes/memberships";
import { opsRouter } from "./routes/ops";
import { organizationsRouter } from "./routes/organizations";
import { preferencesRouter } from "./routes/preferences";
import { publicRouter } from "./routes/public";

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

app.use("/health", healthRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/manager-applications", managerApplicationsRouter);
app.use("/v1/me/contacts", contactsRouter);
app.use("/v1/me/notification-preferences", preferencesRouter);
app.use("/v1/me", meRouter);
app.use("/v1/organizations", organizationsRouter);
app.use("/v1/memberships", membershipsRouter);
app.use("/v1/public", publicRouter);
app.use("/v1/ops", opsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
