import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./env";
import { seedPlatformWallets } from "./services/gas";

await seedPlatformWallets();

app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
