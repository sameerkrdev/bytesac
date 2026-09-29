import request from "supertest";
import { logger } from "@repo/logger";
import { expect, it, vi } from "vitest";
import { app } from "../../src/app";

it("access logs carry the path but never the query string", async () => {
  const http = vi.spyOn(logger, "http");
  await request(app).get("/health?q=ada@example.com");
  await vi.waitFor(() => expect(http).toHaveBeenCalled());
  const line = http.mock.calls.map((c) => String(c[0])).find((l) => l.includes("/health"));
  expect(line).toBeDefined();
  expect(line).not.toContain("ada@example.com");
  http.mockRestore();
});
