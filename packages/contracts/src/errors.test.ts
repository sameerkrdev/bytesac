import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_HTTP_STATUS, apiErrorBodySchema } from "./errors.js";

describe("errors", () => {
  it("every code has an HTTP status", () => {
    for (const code of ERROR_CODES) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
  it("parses the error body shape", () => {
    const body = { error: { code: "SESSION_EXPIRED", message: "Session expired" } };
    expect(apiErrorBodySchema.parse(body)).toEqual(body);
    expect(() => apiErrorBodySchema.parse({ error: { code: "NOPE", message: "x" } })).toThrow();
  });
});
