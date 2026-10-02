import { Queue } from "bullmq";
import { logger } from "@repo/logger";
import type { NotificationKind } from "@repo/validator";
import { env } from "./env";

/** `:` is not allowed in BullMQ queue names or custom job ids, so ids join their parts with `_`. */
const queue = (name: string) => new Queue(name, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
});

export const queues = {
  "price-snapshot": queue("price-snapshot"),
  "basket-performance": queue("basket-performance"),
  "search-index-refresh": queue("search-index-refresh"),
  "embed-basket": queue("embed-basket"),
  "track-leg": queue("track-leg"),
  "reconcile-positions": queue("reconcile-positions"),
  "gas-wallet-check": queue("gas-wallet-check"),
  "revenue-reconcile": queue("revenue-reconcile"),
  notifications: queue("notifications"),
};

interface JobData {
  "price-snapshot": Record<string, never>;
  "basket-performance": { basketId?: string };
  "search-index-refresh": { basketId: string };
  /** `attempt` (the row's `embedding_attempts`) makes a retry a new job id, so a retained failed job never blocks the sweep. */
  "embed-basket": { basketId: string; versionId: string; attempt?: number };
  /** `recheck` n is the hourly re-check of a leg left UNKNOWN (n = 1 .. 168, seven days). */
  "track-leg": { legId: string; recheck?: number };
  "reconcile-positions": { userId?: string };
  "gas-wallet-check": Record<string, never>;
  "revenue-reconcile": Record<string, never>;
  /** `deliver`: email and push for one inbox row. `version-published`: cancel open plans and notify holders. `basket-notice`: tell holders of a status change. */
  notifications:
    | { job: "deliver"; notificationId: string }
    | { job: "version-published"; basketId: string; versionId: string }
    | { job: "basket-notice"; basketId: string; kind: NotificationKind; eventId: string };
}

/**
 * Adds a job. Refresh jobs are delayed to the end of a 10 s window and share an id per basket and window, so a burst of changes runs once and
 * sees all of them; embed jobs are one per basket version and attempt.
 */
export async function enqueue<N extends keyof JobData>(name: N, data: JobData[N]): Promise<void> {
  try {
    if (name === "search-index-refresh") {
      const { basketId } = data as JobData["search-index-refresh"];
      const windowEnd = (Math.floor(Date.now() / 10_000) + 1) * 10_000;
      await queues[name].add(name, data, { jobId: `search_${basketId}_${windowEnd}`, delay: windowEnd - Date.now() });
    } else if (name === "embed-basket") {
      const { basketId, versionId, attempt = 0 } = data as JobData["embed-basket"];
      await queues[name].add(name, data, { jobId: `embed_${basketId}_${versionId}_${attempt}` });
    } else if (name === "track-leg") {
      // First tracking: back off 15 s, 30 s, 60 s ... (the tracker itself marks the leg UNKNOWN once it is 30 minutes old); rechecks run once, hourly.
      const { legId, recheck = 0 } = data as JobData["track-leg"];
      await queues[name].add(name, data, recheck
        ? { jobId: `leg_${legId}_recheck_${recheck}`, delay: 3_600_000, attempts: 1 }
        : { jobId: `leg_${legId}`, attempts: 12, backoff: { type: "exponential", delay: 15_000 } });
    } else if (name === "notifications") {
      const d = data as JobData["notifications"];
      const jobId = d.job === "deliver" ? `deliver_${d.notificationId}` : d.job === "version-published" ? `published_${d.versionId}` : `notice_${d.kind}_${d.eventId}`;
      await queues[name].add(d.job, d, { jobId });
    } else await queues[name].add(name, data);
  } catch (err) {
    // A committed change is not undone by a queue outage; the next change or the sweep catches up.
    logger.warn("enqueue failed", { name, errMessage: err instanceof Error ? err.message : "unknown" });
  }
}
