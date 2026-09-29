import cookieParser from "cookie-parser";
import express from "express";
import type { AppDeps } from "./deps.js";
import { errorHandler } from "./shared/error-handler.js";
import { requestContext } from "./shared/request-context.js";

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.env.TRUST_PROXY);
  app.use(requestContext);
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    const checks = await Promise.allSettled([deps.health.db(), deps.health.redis()]);
    const [db, redis] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
    const ok = db === "ok" && redis === "ok";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db, redis });
  });

  // Routers are mounted here by later tasks (security middleware, /v1/auth, /v1/me ...).

  app.use((_req, res) => { res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } }); });
  app.use(errorHandler(deps.logger));
  return app;
}
