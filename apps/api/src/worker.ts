import { Worker } from "bullmq";
import { logger } from "@repo/logger";
import { env } from "./env";
import { queues } from "./queues";
import { runBasketPerformance, runPriceSnapshot } from "./services/performance";

/**
 * Starts one Worker per queue and registers the repeatable jobs. `upsertJobScheduler` is keyed by a fixed id, so any number of instances (or restarts)
 * leaves exactly one schedule in Redis and each tick runs once.
 */
export async function startWorker(): Promise<Worker[]> {
  const connection = { url: env.REDIS_URL };
  const workers = [
    new Worker("price-snapshot", () => runPriceSnapshot(), { connection }),
    new Worker("basket-performance", (job) => runBasketPerformance(job.data.basketId), { connection }),
  ];
  for (const w of workers) w.on("failed", (job, err) => logger.error("job failed", { queue: w.name, job: job?.name, attempt: job?.attemptsMade, errMessage: err.message }));
  await queues["price-snapshot"].upsertJobScheduler("price-snapshot-daily", { pattern: "5 0 * * *", tz: "UTC" }, { name: "price-snapshot", data: {} });
  logger.info("worker started");
  return workers;
}

if (env.NODE_ENV !== "test") {
  const workers = await startWorker();
  process.on("SIGTERM", async () => {
    await Promise.all([...workers.map((w) => w.close()), ...Object.values(queues).map((q) => q.close())]);
    process.exit(0);
  });
}
