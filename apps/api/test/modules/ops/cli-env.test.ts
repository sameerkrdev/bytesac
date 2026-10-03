import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("ops CLI environment", () => {
  it("starts with only DATABASE_URL and LOG_LEVEL: no provider keys are required", () => {
    const { DATABASE_URL, PATH, SystemRoot } = process.env;
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/ops/cli.ts", "no-such-command"], {
      env: { DATABASE_URL, LOG_LEVEL: "error", PATH, SystemRoot },
      encoding: "utf8",
    });
    expect(run.stderr).toContain("Unknown command: no-such-command"); // reached the command dispatch, past every import
    expect(run.stderr).not.toContain("Invalid environment variables");
  });
});
