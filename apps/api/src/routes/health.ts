import { db } from "@repo/db";
import { sql } from "drizzle-orm";
import { Router } from "express";
import { redis } from "../middleware/rate-limit";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks = await Promise.allSettled([db.execute(sql`select 1`), redis.ping()]);
  const [dbStatus, redisStatus] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
  const ok = dbStatus === "ok" && redisStatus === "ok";
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db: dbStatus, redis: redisStatus });
});
