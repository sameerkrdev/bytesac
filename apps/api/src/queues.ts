import { Queue } from "bullmq";
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
};

interface JobData {
  "price-snapshot": Record<string, never>;
  "basket-performance": { basketId?: string };
  "search-index-refresh": { basketId: string };
  /** `attempt` (the row's `embedding_attempts`) makes a retry a new job id, so a retained failed job never blocks the sweep. */
  "embed-basket": { basketId: string; versionId: string; attempt?: number };
}

/**
 * Adds a job. Refresh jobs are delayed to the end of a 10 s window and share an id per basket and window, so a burst of changes runs once and
 * sees all of them; embed jobs are one per basket version and attempt.
 */
export async function enqueue<N extends keyof JobData>(name: N, data: JobData[N]): Promise<void> {
  if (name === "search-index-refresh") {
    const { basketId } = data as JobData["search-index-refresh"];
    const windowEnd = (Math.floor(Date.now() / 10_000) + 1) * 10_000;
    await queues[name].add(name, data, { jobId: `search_${basketId}_${windowEnd}`, delay: windowEnd - Date.now() });
  } else if (name === "embed-basket") {
    const { basketId, versionId, attempt = 0 } = data as JobData["embed-basket"];
    await queues[name].add(name, data, { jobId: `embed_${basketId}_${versionId}_${attempt}` });
  } else await queues[name].add(name, data);
}
