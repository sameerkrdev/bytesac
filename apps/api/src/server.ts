import type { Server } from "node:http";
import { db } from "@repo/db";
import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "@/config/dotenv";
import { queues } from "@/config/queues";
import { redis } from "@/middlewares/rate-limit.middleware";
import { seedPlatformWallets } from "@/services/gas";

let server: Server | undefined;

/** Stops accepting requests, then closes the queues, Redis and the DB pool. Runs only on a signal, never on import. */
const shutdown = async (signal: string) => {
  logger.info("shutting down", { signal });
  try {
    if (server) {
      const closed = new Promise<void>((resolve, reject) => { server?.close((err) => { if (err) reject(err); else resolve(); }); });
      server.closeIdleConnections();
      await closed;
    }
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await redis.quit();
    await db.$client.end();
    process.exit(0);
  } catch (error) {
    logger.error("shutdown failed", { errMessage: error instanceof Error ? error.message : "unknown" });
    process.exit(1);
  }
};

const startServer = async () => {
  try {
    await seedPlatformWallets();
    server = app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
  } catch (error) {
    logger.error("failed to start api", { errMessage: error instanceof Error ? error.message : "unknown" });
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void startServer();
