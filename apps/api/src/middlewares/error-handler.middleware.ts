import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import createHttpError, { isHttpError } from "http-errors";
import { logger } from "@repo/logger";
import { ERROR_HTTP_STATUS, errorCodeSchema, ZodError, type ApiErrorBody } from "@repo/validator";

const SECRET_KEY = /password|token|signature|secret|otp|code/i;

const redact = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(redact)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]))
  : value;

/** Request context for error logs. Body values are never logged (signed transactions, PSBTs, free text, addresses): only the key names. Query values are masked by key. `routeParams` (not `params`) so log scans for driver query params stay clean. */
const requestLogContext = (req: Request) => ({ method: req.method, path: req.originalUrl.split("?")[0], routeParams: req.params, query: redact(req.query), bodyKeys: Object.keys(req.body ?? {}) });

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(createHttpError("Not found", { code: "NOT_FOUND" }));
};

/**
 * Drizzle/postgres errors embed SQL text and bound params (emails, phones, hashes).
 * Log only name, pg code and the underlying driver message; never `query` or `params`.
 */
function sanitizeError(err: unknown): { errName: string; errCode?: string; errMessage: string; stack?: string } {
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
    // The stack of a driver error starts with the SQL text and params, so it is never logged.
    ...(!isDrizzleQuery && typeof (err as { stack?: unknown }).stack === "string" ? { stack: (err as { stack: string }).stack } : {}),
  };
}

/** Responds `{ error: { code, message, details? } }`. Errors thrown by the API are http-errors carrying a `code` from @repo/validator; the HTTP status comes from ERROR_HTTP_STATUS, so call sites pass no status. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) { next(err); return; }
  let status = 500;
  let error: ApiErrorBody["error"] = { code: "INTERNAL", message: "Something went wrong" };
  const code = isHttpError(err) ? errorCodeSchema.safeParse(err.code) : null;

  if (err instanceof ZodError) {
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Request validation failed", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  } else if (isHttpError(err) && code?.success) {
    status = ERROR_HTTP_STATUS[code.data];
    error = { code: code.data, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) };
    if (err.headers) res.set(err.headers);
    if (status >= 500) logger.warn("api error", { requestId: req.ctx?.requestId, errorCode: code.data, message: err.message, name: err.name, stack: err.stack, ...requestLogContext(req) });
  } else if (isHttpError(err) && err.type === "entity.parse.failed") {
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Malformed JSON body" };
  } else if (isHttpError(err) && err.status >= 400 && err.status < 500) {
    // body-parser client errors (413, 415, bad charset...)
    status = 400;
    error = { code: "VALIDATION_FAILED", message: "Invalid request body" };
  } else {
    logger.error("unhandled error", { requestId: req.ctx?.requestId, ...sanitizeError(err), ...requestLogContext(req) });
  }
  res.status(status).json({ error });
};
