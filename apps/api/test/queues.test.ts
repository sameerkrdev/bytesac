import { afterAll, describe, expect, it, vi } from "vitest";

// The global setup replaces "@/config/queues" with a fake; this test needs the real queues (they connect to TEST_REDIS_URL).
const { enqueue, queues } = await vi.importActual<typeof import("@/config/queues")>("@/config/queues");

afterAll(async () => { await Promise.all(Object.values(queues).map((q) => q.close())); });

describe("queue producers", () => {
  // Spec 22 B-26: the first tracking attempt comes after 5 s, not 15 s.
  it("track-leg backs off from 5 s", async () => {
    const legId = "00000000-0000-4000-8000-000000000005";
    await enqueue("track-leg", { legId });
    const job = await queues["track-leg"].getJob(`leg_${legId}`);
    expect(job?.opts).toMatchObject({ attempts: 12, backoff: { type: "exponential", delay: 5_000 } });
    await job?.remove();
  });

  // BullMQ production guide: producers fail fast while Redis is down, and every Queue needs an error listener.
  it.each(Object.entries(queues))("%s fails fast offline and logs connection errors", (_name, q) => {
    expect(q.opts.connection).toMatchObject({ enableOfflineQueue: false });
    expect(q.listenerCount("error")).toBeGreaterThan(0);
  });
});
