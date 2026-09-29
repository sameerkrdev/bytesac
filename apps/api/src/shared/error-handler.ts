import { ERROR_HTTP_STATUS, type ApiErrorBody } from "@repo/validator";
import type { ErrorRequestHandler } from "express";
import { DomainError } from "./errors.js";
import type { Logger } from "./logger.js";

function isBodyParseError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "entity.parse.failed";
}

/** body-parser / http-errors client errors (413, 415, bad charset...) carry a 4xx status. */
function isClientHttpError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; statusCode?: unknown };
  const s = typeof e.status === "number" ? e.status : e.statusCode;
  return typeof s === "number" && s >= 400 && s <= 499;
}

/**
 * Drizzle/postgres errors embed SQL text and bound params (emails, phones, hashes).
 * Log only name, pg code and the underlying driver message; never `query` or `params`.
 */
function sanitizeError(err: unknown): { errName: string; errCode?: string; errMessage: string } {
  if (typeof err !== "object" || err === null) return { errName: typeof err, errMessage: "non-object error thrown" };
  const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const cause = typeof e.cause === "object" && e.cause !== null ? (e.cause as { message?: unknown; code?: unknown }) : null;
  const isDrizzleQuery = e.name === "DrizzleQueryError";
  const source = isDrizzleQuery && cause ? cause : e;
  const code = typeof source.code === "string" ? source.code : typeof e.code === "string" ? e.code : undefined;
  return {
    errName: typeof e.name === "string" ? e.name : "Error",
    ...(code === undefined ? {} : { errCode: code }),
    errMessage: isDrizzleQuery && !cause ? "database query failed" : typeof source.message === "string" ? source.message : "unknown",
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) { next(err); return; }
    let body: ApiErrorBody;
    let status: number;
    if (err instanceof DomainError) {
      status = ERROR_HTTP_STATUS[err.code];
      body = { error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) } };
      if (err.retryAfterSec !== undefined) res.setHeader("Retry-After", String(err.retryAfterSec));
      if (status >= 500) logger.warn({ requestId: req.ctx?.requestId, code: err.code }, "domain error");
    } else if (isBodyParseError(err)) {
      status = 400;
      body = { error: { code: "VALIDATION_FAILED", message: "Malformed JSON body" } };
    } else if (isClientHttpError(err)) {
      status = 400;
      body = { error: { code: "VALIDATION_FAILED", message: "Invalid request body" } };
    } else {
      status = 500;
      body = { error: { code: "INTERNAL", message: "Something went wrong" } };
      logger.error({ requestId: req.ctx?.requestId, ...sanitizeError(err) },"unhandled error");
    }
    res.status(status).json(body);
  };
}
