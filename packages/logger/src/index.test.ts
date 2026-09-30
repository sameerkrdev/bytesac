import { PassThrough } from "node:stream";
import winston from "winston";
import { describe, expect, it } from "vitest";
import { logger } from "./index";

function capture(): { lines: () => string[]; remove: () => void } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c.toString()));
  const transport = new winston.transports.Stream({ stream, format: winston.format.json() });
  logger.add(transport);
  return { lines: () => chunks, remove: () => logger.remove(transport) };
}

describe("logger", () => {
  it("redacts secrets at any depth and keeps other fields", () => {
    const c = capture();
    logger.error("boom", { token: "t0k", nested: { signature: "0xsig", code: "123456", list: [{ value: "a@b.co" }] }, errCode: "23505" });
    c.remove();
    const out = c.lines().join("");
    for (const secret of ["t0k", "0xsig", "123456", "a@b.co"]) expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
    expect(out).toContain("23505");
  });
  it("redacts application tokens and personal or free-text fields", () => {
    const c = capture();
    logger.warn("body", { statusToken: "st0k", "x-application-token": "h0k", fullName: "Ada Lovelace", professionalBackground: "bg", internalNote: "n0te", reason: "kept" });
    c.remove();
    const out = c.lines().join("");
    for (const secret of ["st0k", "h0k", "Ada Lovelace", "n0te"]) expect(out).not.toContain(secret);
    expect(out).toContain("kept");
  });
  it("supports the http level used for request logs", () => {
    const c = capture();
    logger.http("GET /health 200");
    c.remove();
    expect(c.lines().join("")).toContain('"level":"http"');
  });
});
