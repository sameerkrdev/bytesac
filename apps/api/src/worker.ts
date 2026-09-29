import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { loadDotEnvIfPresent, loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { runRetention } from "./jobs/retention.js";
import { createLogger } from "./shared/logger.js";

loadDotEnvIfPresent();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
if (!env.RETENTION_DATABASE_URL) throw new Error("RETENTION_DATABASE_URL is required for the worker");
const { db } = createDb(env.RETENTION_DATABASE_URL, { max: 2 });

// BullMQ bundles its own ioredis; pass connection options (not an instance) to avoid version mismatch.
const u = new URL(env.REDIS_URL);
const connection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  username: u.username ? decodeURIComponent(u.username) : undefined,
  password: u.password ? decodeURIComponent(u.password) : undefined,
  db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
  tls: u.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null,
};

const queue = new Queue("retention", { connection });
await queue.upsertJobScheduler("retention-daily", { pattern: "0 3 * * *", tz: "UTC" }, { name: "purge" });

new Worker("retention", async () => {
  const out = await runRetention(db, `retention-${randomUUID()}`);
  logger.info(out, "retention purge complete");
}, { connection, concurrency: 1 });

logger.info("worker started");
