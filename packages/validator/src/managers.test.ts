import { describe, expect, it } from "vitest";
import { APPLICATION_STATUSES, APPLICATION_TRANSITIONS, createApplicationRequestSchema } from "./index";

const text = "x".repeat(30);
const valid = {
  applicantType: "individual", fullName: "Ada Lovelace", email: " Ada@Example.COM ", country: "GB",
  professionalBackground: text, investmentExperience: text, reason: text, intendedBaskets: text,
  walletChain: "solana", walletAddress: "So11111111111111111111111111111111111111112",
};

describe("manager application schemas", () => {
  it("accepts a valid individual and normalises the email", () => {
    expect(createApplicationRequestSchema.parse(valid).email).toBe("ada@example.com");
  });
  it("requires firmName for firms", () => {
    expect(() => createApplicationRequestSchema.parse({ ...valid, applicantType: "firm" })).toThrow();
    expect(createApplicationRequestSchema.parse({ ...valid, applicantType: "firm", firmName: "Lovelace Capital" }).firmName).toBe("Lovelace Capital");
  });
  it("rejects an http website", () => {
    expect(() => createApplicationRequestSchema.parse({ ...valid, website: "http://example.com" })).toThrow();
    expect(createApplicationRequestSchema.parse({ ...valid, website: "https://example.com" }).website).toBe("https://example.com");
  });
  it("transition table has no self-loops and empty terminal states", () => {
    for (const s of APPLICATION_STATUSES) expect(APPLICATION_TRANSITIONS[s]).not.toContain(s);
    expect(APPLICATION_TRANSITIONS.SCREENING_APPROVED).toEqual(["SCREENING_REJECTED"]);
    expect(APPLICATION_TRANSITIONS.SCREENING_REJECTED).toEqual([]);
  });
});
