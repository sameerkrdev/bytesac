import type { ErrorRequestHandler, RequestHandler } from "express";
import createHttpError, { isHttpError } from "http-errors";
import { logger } from "@repo/logger";
import { errorCodeSchema, ZodError, type ApiErrorBody } from "@repo/validator";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(createHttpError(404, "Not found", { code: "NOT_FOUND" }));
};

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

/** Responds `{ error: { code, message, details? } }`. Errors thrown by the API are http-errors carrying a `code` from @repo/validator. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) { next(err); return; }
  let status = 500;
  let error: ApiErrorBody["error"] = { code: "INTERNAL", message: "Something went wrong" };
  const code = isHttpError(err) ? errorCodeSchema.safeParse(err.code) : null;

  if (err instanceof ZodError) {
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Request validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  } else if (isHttpError(err) && code?.success) {
    status = err.status;
    error = { code: code.data, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) };
    if (err.headers) res.set(err.headers);
    if (status >= 500) logger.warn("api error", { requestId: req.ctx?.requestId, errorCode: code.data });
  } else if (isHttpError(err) && err.type === "entity.parse.failed") {
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Malformed JSON body" };
  } else if (isHttpError(err) && err.status >= 400 && err.status < 500) {
    // body-parser client errors (413, 415, bad charset...)
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Invalid request body" };
  } else {
    logger.error("unhandled error", { requestId: req.ctx?.requestId, ...sanitizeError(err) });
  }
  res.status(status).json({ error });
};
