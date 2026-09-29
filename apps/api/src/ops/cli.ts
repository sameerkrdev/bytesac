import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { chainSchema } from "@repo/contracts";
import { loadDotEnvIfPresent, loadEnv } from "../config/env.js";
import { createDb } from "../db/client.js";
import { disableAddress, reactivateAddress, suspendUser } from "./ops-service.js";

loadDotEnvIfPresent();
const env = loadEnv();
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({
  args: rest,
  options: { chain: { type: "string" }, address: { type: "string" }, reason: { type: "string" }, operator: { type: "string" }, user: { type: "string" } },
});
const requestId = `ops-${randomUUID()}`;
const { db, close } = createDb(env.DATABASE_URL, { max: 1 });

try {
  const operator = values.operator ?? "";
  if (command === "address-disable") {
    console.log(await disableAddress(db, { chain: chainSchema.parse(values.chain), address: values.address ?? "", reason: values.reason ?? "", operator, requestId }));
  } else if (command === "address-reactivate") {
    console.log({ reactivated: await reactivateAddress(db, { chain: chainSchema.parse(values.chain), address: values.address ?? "", operator, requestId }) });
  } else if (command === "user-suspend") {
    console.log({ revokedSessions: await suspendUser(db, { userId: values.user ?? "", reason: values.reason ?? "", operator, requestId }) });
  } else {
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
  console.log(`requestId=${requestId}`);
} finally {
  await close();
}
