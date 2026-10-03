import { Worker } from "bullmq";
import { db } from "@repo/db";
import { logger } from "@repo/logger";
import { env } from "@/config/dotenv";
import { enqueue, queues } from "@/config/queues";
import { redis } from "@/middlewares/rate-limit.middleware";
import { reconcileRevenue } from "@/modules/fees/fees.service";
import { checkGasWallets, seedPlatformWallets } from "@/modules/operations/gas.service";
import { deliverNotification, fanOutToHolders } from "@/modules/notifications/notifications.service";
import { onVersionPublished } from "@/modules/rebalance/rebalance.service";
import { expireStalePlans, stopStalledRecoveries, trackLeg, trackStaleClaims } from "@/modules/portfolio/tracking.service";
import { reconcilePositions } from "@/modules/portfolio/reconciliation.service";
import { runBasketPerformance, runPriceSnapshot } from "@/modules/discovery/performance.service";
import { embedBasket, refreshSearchIndex, sweepEmbeddings } from "@/modules/discovery/search-index.service";

/** Every 5 minutes: hand stuck legs to the tracker and cancel expired, untouched plans (releasing their gas reservations). */
const sweepOperations = async () => { await trackStaleClaims(); await expireStalePlans(); await stopStalledRecoveries(); };

/**
 * Starts one Worker per queue and registers the repeatable jobs. `upsertJobScheduler` is keyed by a fixed id, so any number of instances (or restarts)
 * leaves exactly one schedule in Redis and each tick runs once.
 */
export async function startWorker(): Promise<Worker[]> {
  const connection = { url: env.REDIS_URL };
  await seedPlatformWallets();
  const workers = [
    new Worker("price-snapshot", () => runPriceSnapshot(), { connection }),
    new Worker("basket-performance", (job) => runBasketPerformance(job.data.basketId), { connection }),
    new Worker("search-index-refresh", (job) => refreshSearchIndex(job.data.basketId), { connection }),
    // The embed queue also carries the sweep, registered below as a job named "sweep".
    new Worker("embed-basket", (job) => (job.name === "sweep" ? sweepEmbeddings() : embedBasket(job.data.basketId)), { connection }),
    new Worker("track-leg", (job) => (job.name === "sweep" ? sweepOperations() : trackLeg(job.data.legId, job.data.recheck)), { connection }),
    new Worker("reconcile-positions", (job) => reconcilePositions(job.data.userId), { connection }),
    new Worker("gas-wallet-check", () => checkGasWallets(), { connection }),
    new Worker("revenue-reconcile", () => reconcileRevenue(), { connection }),
    new Worker("notifications", (job) => {
      const d = job.data as Parameters<typeof enqueue<"notifications">>[1];
      return d.job === "deliver" ? deliverNotification(d.notificationId) : d.job === "version-published" ? onVersionPublished(d.basketId, d.versionId) : fanOutToHolders(d.basketId, d.kind, {}, `${d.kind}:${d.eventId}`);
    }, { connection }),
  ];
  workers[4]!.on("failed", async (job) => {
    if (job?.name === "track-leg" && !job.data.recheck && job.attemptsMade >= (job.opts.attempts ?? 1)) await enqueue("track-leg", { legId: job.data.legId, recheck: 1 });
  });
  for (const w of workers) w.on("failed", (job, err) => logger.error("job failed", { queue: w.name, job: job?.name, attempt: job?.attemptsMade, errMessage: err.message }));
  await queues["price-snapshot"].upsertJobScheduler("price-snapshot-daily", { pattern: "5 0 * * *", tz: "UTC" }, { name: "price-snapshot", data: {} });
  await queues["embed-basket"].upsertJobScheduler("embed-sweep", { every: 900_000 }, { name: "sweep", data: {}, opts: { attempts: 1 } });
  await queues["track-leg"].upsertJobScheduler("track-claims-sweep", { every: 300_000 }, { name: "sweep", data: {}, opts: { attempts: 1 } });
  await queues["reconcile-positions"].upsertJobScheduler("reconcile-positions-nightly", { pattern: "30 2 * * *", tz: "UTC" }, { name: "reconcile-positions", data: {} });
  await queues["gas-wallet-check"].upsertJobScheduler("gas-wallet-check-15m", { every: 900_000 }, { name: "gas-wallet-check", data: {}, opts: { attempts: 1 } });
  // 04:00 UTC: the previous UTC day's settled platform fees against the revenue treasury's inflows.
  await queues["revenue-reconcile"].upsertJobScheduler("revenue-reconcile-daily", { pattern: "0 4 * * *", tz: "UTC" }, { name: "revenue-reconcile", data: {}, opts: { attempts: 1 } });
  logger.info("worker started");
  return workers;
}

if (env.NODE_ENV !== "test") {
  const workers = await startWorker();
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(1), 10_000).unref();
    logger.info("worker shutting down", { signal });
    try {
      await Promise.all([...workers.map((w) => w.close()), ...Object.values(queues).map((q) => q.close())]);
      await redis.quit();
      await db.$client.end();
      process.exit(0);
    } catch (error) {
      logger.error("worker shutdown failed", { errMessage: error instanceof Error ? error.message : "unknown" });
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
