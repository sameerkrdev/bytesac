import { afterAll, describe, expect, it, vi } from "vitest";

// The global setup replaces "@/config/queues" with a fake; this test needs the real queues (they connect to TEST_REDIS_URL).
const { queues } = await vi.importActual<typeof import("@/config/queues")>("@/config/queues");

afterAll(async () => { await Promise.all(Object.values(queues).map((q) => q.close())); });

describe("queue producers", () => {
  // BullMQ production guide: producers fail fast while Redis is down, and every Queue needs an error listener.
  it.each(Object.entries(queues))("%s fails fast offline and logs connection errors", (_name, q) => {
    expect(q.opts.connection).toMatchObject({ enableOfflineQueue: false });
    expect(q.listenerCount("error")).toBeGreaterThan(0);
  });
});
