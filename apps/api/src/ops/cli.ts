import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { db } from "@repo/db";
import { chainSchema, platformRoleSchema, z } from "@repo/validator";
import { grantRole } from "@/modules/manager-applications/platform-roles.service";
import { disableAddress, reactivateAddress, suspendUser } from "@/modules/ops/ops.service";

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const { values } = parseArgs({
  args: rest,
  options: { chain: { type: "string" }, address: { type: "string" }, reason: { type: "string" }, operator: { type: "string" }, user: { type: "string" }, role: { type: "string" } },
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
  } else if (command === "grant-role") {
    if (!operator.trim()) throw new Error("operator is required");
    console.log(await grantRole({ operator, requestId }, z.uuid().parse(values.user), platformRoleSchema.parse(values.role)));
  } else {
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
  console.log(`requestId=${requestId}`);
} finally {
  await db.$client.end({ timeout: 5 });
}
