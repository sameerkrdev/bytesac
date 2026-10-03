import { db } from "@repo/db";
import { sql } from "drizzle-orm";
import { redis } from "@/middlewares/rate-limit.middleware";

export async function checkHealth() {
  const checks = await Promise.allSettled([db.execute(sql`select 1`), redis.ping()]);
  const [dbStatus, redisStatus] = checks.map((c) => (c.status === "fulfilled" ? "ok" : "down"));
  const ok = dbStatus === "ok" && redisStatus === "ok";
  return { ok, body: { status: ok ? "ok" : "degraded", db: dbStatus, redis: redisStatus } };
}
