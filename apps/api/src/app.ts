import cookieParser from "cookie-parser";
import express from "express";
import type { AppDeps } from "./deps.js";
import { authRouter } from "./modules/identity/http/auth-routes.js";
import { contactsRouter } from "./modules/contacts/http/contact-routes.js";
import { preferencesRouter } from "./modules/contacts/http/preferences-routes.js";
import { meRouter } from "./modules/identity/http/me-routes.js";
import { csrfGuard, noCors, rejectDualAuth } from "./http/security.js";
import { errorHandler } from "./shared/error-handler.js";
import { requestContext } from "./shared/request-context.js";

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.env.TRUST_PROXY);
  app.use(requestContext);
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use(noCors, rejectDualAuth, csrfGuard(deps.env.ALLOWED_ORIGINS));

  app.get("/health", async (_req, res) => {
    const checks = await Promise.allSettled([deps.health.db(), deps.health.redis()]);
    const [db, redis] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
    const ok = db === "ok" && redis === "ok";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db, redis });
  });

  app.use("/v1/auth", authRouter(deps));
  app.use("/v1/me/contacts", contactsRouter(deps));
  app.use("/v1/me/notification-preferences", preferencesRouter(deps));
  app.use("/v1/me", meRouter(deps));

  app.use((_req, res) => { res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } }); });
  app.use(errorHandler(deps.logger));
  return app;
}
