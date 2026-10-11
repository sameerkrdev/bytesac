import { ERROR_CODES } from "@repo/validator";
import { describe, expect, it } from "vitest";
import { describeError } from "./error-copy";

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
  it("GROUP_EXPIRED says nothing was spent", () => {
    expect(describeError("GROUP_EXPIRED")).toMatchObject({ title: "Quotes expired", recovery: "retry" });
    expect(describeError("GROUP_EXPIRED").message).toContain("nothing was spent");
  });
  it("SOL_REQUIRED names the shortfall when the API gives it, rounded up to 4 decimals", () => {
    expect(describeError("SOL_REQUIRED", { lamportsRequired: "5000000", lamportsHeld: "800001" }).message).toBe("Add about 0.0042 SOL to your Solana wallet, then continue.");
    expect(describeError("SOL_REQUIRED", { lamportsRequired: "5000000", lamportsHeld: "800000" }).message).toBe("Add about 0.0042 SOL to your Solana wallet, then continue.");
  });
  it("SOL_REQUIRED keeps the generic text without usable details", () => {
    const generic = describeError("SOL_REQUIRED").message;
    expect(generic).toContain("~0.003");
    expect(describeError("SOL_REQUIRED", {}).message).toBe(generic);
    expect(describeError("SOL_REQUIRED", { lamportsRequired: "5", lamportsHeld: "9" }).message).toBe(generic);
    expect(describeError("SOL_REQUIRED", { lamportsRequired: "x", lamportsHeld: "1" }).message).toBe(generic);
  });
});
