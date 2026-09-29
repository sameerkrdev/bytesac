import { resetTestDatabase } from "@repo/db/testing";
import type { TestProject } from "vitest/node";

export default async function setup({ config }: TestProject): Promise<void> {
  const adminUrl = config.env.TEST_ADMIN_DATABASE_URL as string | undefined;
  if (!adminUrl) throw new Error("TEST_ADMIN_DATABASE_URL is required (see apps/api/.env.example)");
  await resetTestDatabase(adminUrl);
}
