import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { db } from "@repo/db";
import { chainSchema } from "@repo/validator";
import { disableAddress, reactivateAddress, suspendUser } from "../services/ops";

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({
  args: rest,
  options: { chain: { type: "string" }, address: { type: "string" }, reason: { type: "string" }, operator: { type: "string" }, user: { type: "string" } },
});
const requestId = `ops-${randomUUID()}`;

try {
  const operator = values.operator ?? "";
  if (command === "address-disable") {
    console.log(await disableAddress({ chain: chainSchema.parse(values.chain), address: values.address ?? "", reason: values.reason ?? "", operator, requestId }));
  } else if (command === "address-reactivate") {
    console.log({ reactivated: await reactivateAddress({ chain: chainSchema.parse(values.chain), address: values.address ?? "", operator, requestId }) });
  } else if (command === "user-suspend") {
    console.log({ revokedSessions: await suspendUser({ userId: values.user ?? "", reason: values.reason ?? "", operator, requestId }) });
  } else {
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
  console.log(`requestId=${requestId}`);
} finally {
  await db.$client.end({ timeout: 5 });
}
