import type { NextFunction, Request, Response } from "express";
import { DomainError } from "../shared/errors.js";

export const SESSION_COOKIE = "bx_session";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_ENTRY = new Set(["/v1/auth/challenge", "/v1/auth/verify"]);

/** The API is never called cross-origin by browsers: no CORS headers, preflight refused. */
export function noCors(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") {
    res.status(403).json({ error: { code: "CSRF_REJECTED", message: "Cross-origin requests are not allowed" } });
    return;
  }
  next();
}

export function rejectDualAuth(req: Request, _res: Response, next: NextFunction): void {
  const hasBearer = /^Bearer\s+/i.test(req.header("authorization") ?? "");
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (hasBearer && cookies?.[SESSION_COOKIE]) {
    throw new DomainError("VALIDATION_FAILED", "Use either a session cookie or a bearer token, not both");
  }
  next();
}

/** Express routing is case-insensitive and non-strict, so match on a normalised path. */
function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/[/]+$/, "") : lower;
}

export function csrfGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!MUTATING.has(req.method)) return next();
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const hasCookie = Boolean(cookies?.[SESSION_COOKIE]);
    const body = req.body as { client?: unknown } | undefined;
    const path = normalizePath(req.path);
    const webAuthEntry = AUTH_ENTRY.has(path) && body?.client === "web";
    const challengeWithoutClient = path === "/v1/auth/challenge" && !/^Bearer\s+/i.test(req.header("authorization") ?? "") && req.header("x-client") !== "mobile";
    if (!hasCookie && !webAuthEntry && !challengeWithoutClient) return next();
    const origin = req.header("origin");
    if (!origin || !allowed.has(origin) || req.header("x-requested-with") !== "bytesac") {
      throw new DomainError("CSRF_REJECTED", "Request rejected by CSRF protection");
    }
    next();
  };
}
