import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("firebase messaging service worker", () => {
  // The worker loads the compat scripts from gstatic by version (it cannot import the npm package): they must track the `firebase` dependency.
  it("loads the same firebase version as the firebase dependency", () => {
    const { dependencies } = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    const versions = [...readFileSync("public/firebase-messaging-sw.js", "utf8").matchAll(/firebasejs\/([\d.]+)\//g)].map((m) => m[1]);
    expect(versions).toHaveLength(2);
    for (const v of versions) expect(v).toBe(dependencies.firebase);
  });
});
