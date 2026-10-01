import { Worker } from "bullmq";
import { logger } from "@repo/logger";
import { env } from "./env";
import { enqueue, queues } from "./queues";
import { seedPlatformWallets } from "./services/gas";
import { checkGasWallets, expireStalePlans, reconcilePositions, trackLeg, trackStaleClaims } from "./services/positions";
import { runBasketPerformance, runPriceSnapshot } from "./services/performance";
import { embedBasket, refreshSearchIndex, sweepEmbeddings } from "./services/search-index";

/** Every 5 minutes: hand stuck legs to the tracker and cancel expired, untouched plans (releasing their gas reservations). */
const sweepOperations = async () => { await trackStaleClaims(); await expireStalePlans(); };

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
