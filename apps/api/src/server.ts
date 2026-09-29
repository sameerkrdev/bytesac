import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./env";

app.listen(env.PORT, () => logger.info("api listening", { port: env.PORT }));
