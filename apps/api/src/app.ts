import cookieParser from "cookie-parser";
import express from "express";
import morgan from "morgan";
import { logger } from "@repo/logger";
import { env } from "./env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import { csrfGuard, noCors, rejectDualAuth } from "./middleware/security";
import { authRouter } from "./routes/auth";
import { contactsRouter } from "./routes/contacts";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { preferencesRouter } from "./routes/preferences";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);
app.use(requestContext);
app.use(morgan("combined", { stream: { write: (message) => { logger.http(message.trim()); } } }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(noCors, rejectDualAuth, csrfGuard);

app.use("/health", healthRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/me/contacts", contactsRouter);
app.use("/v1/me/notification-preferences", preferencesRouter);
app.use("/v1/me", meRouter);

app.use(notFoundHandler);
app.use(errorHandler);
