import { ERROR_CODES } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { describeError } from "./error-copy.js";

describe("describeError", () => {
  it("has copy for every API error code plus client-only codes", () => {
    for (const code of [...ERROR_CODES, "NETWORK_ERROR", "WALLET_REJECTED"] as const) {
      const d = describeError(code);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  });
  it("maps recovery actions", () => {
    expect(describeError("CHALLENGE_EXPIRED").recovery).toBe("restart");
    expect(describeError("VERIFIER_UNAVAILABLE").recovery).toBe("retry");
    expect(describeError("SESSION_EXPIRED").recovery).toBe("reauthenticate");
    expect(describeError("ADDRESS_DISABLED").recovery).toBe("contact-support");
    expect(describeError("RATE_LIMITED").recovery).toBe("wait");
  });
});
