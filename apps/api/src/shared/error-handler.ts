import { ERROR_HTTP_STATUS, type ApiErrorBody } from "@repo/contracts";
import type { ErrorRequestHandler } from "express";
import { DomainError } from "./errors.js";
import type { Logger } from "./logger.js";

function isBodyParseError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { type?: unknown }).type === "entity.parse.failed";
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
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
    } else {
      status = 500;
      body = { error: { code: "INTERNAL", message: "Something went wrong" } };
      logger.error({ requestId: req.ctx?.requestId, err }, "unhandled error");
    }
    res.status(status).json(body);
  };
}
