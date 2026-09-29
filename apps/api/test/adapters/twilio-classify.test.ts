import { describe, expect, it } from "vitest";
import { classifyTwilioCheckError } from "../../src/adapters/sms-otp.js";

describe("classifyTwilioCheckError", () => {
  it.each([
    [{ status: 404 }, "rejected"],
    [{ code: 20404 }, "rejected"],
    [{ code: 60202 }, "rejected"],
    [{ status: 429, code: 20429 }, "delivery"],
    [{ status: 429 }, "delivery"],
    [{ status: 500 }, "delivery"],
    [{ status: 401, code: 20003 }, "delivery"],
    [new Error("ECONNRESET"), "delivery"],
    [null, "delivery"],
  ])("%j -> %s", (err, expected) => {
    expect(classifyTwilioCheckError(err)).toBe(expected);
  });
});
