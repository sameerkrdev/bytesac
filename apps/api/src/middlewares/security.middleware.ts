import createHttpError from "http-errors";
import type { NextFunction, Request, Response } from "express";
import { CLIENT_HEADER, CSRF_HEADER, CSRF_HEADER_VALUE, MOBILE_CLIENT, SESSION_COOKIE } from "@repo/validator";
import { env } from "@/config/dotenv";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_ENTRY = new Set(["/v1/auth/challenge", "/v1/auth/verify"]);
const allowedOrigins = new Set(env.ALLOWED_ORIGINS);

/** The API is never called cross-origin by browsers: no CORS headers, preflight refused. */
export function noCors(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") throw createHttpError("Cross-origin requests are not allowed", { code: "CSRF_REJECTED" });
  next();
}

export function rejectDualAuth(req: Request, _res: Response, next: NextFunction): void {
  const hasBearer = /^Bearer\s+/i.test(req.header("authorization") ?? "");
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (hasBearer && cookies?.[SESSION_COOKIE]) {
    throw createHttpError("Use either a session cookie or a bearer token, not both", { code: "VALIDATION_FAILED" });
  }
  next();
}

/** Express routing is case-insensitive and non-strict, so match on a normalised path. */
function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/[/]+$/, "") : lower;
}

export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) return next();
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const hasCookie = Boolean(cookies?.[SESSION_COOKIE]);
  const body = req.body as { client?: unknown } | undefined;
  const path = normalizePath(req.path);
  const hasBearer = /^Bearer\s+/i.test(req.header("authorization") ?? "");
  const webAuthEntry = AUTH_ENTRY.has(path) && body?.client === "web";
  const challengeWithoutClient = path === "/v1/auth/challenge" && !hasBearer &&req.header(CLIENT_HEADER) !== MOBILE_CLIENT;
  // Public application forms are browser-only and cookie-less: require Origin unless a bearer token is present.
  const applicationForm = path.startsWith("/v1/manager-applications") && !hasBearer;
  const publicBrowserPost = !hasBearer && (
    path === "/v1/public/waitlist"
    || (path === "/v1/preview-gate/login" && req.header(CLIENT_HEADER) !== MOBILE_CLIENT)
  );
  if (!hasCookie && !webAuthEntry && !challengeWithoutClient && !applicationForm && !publicBrowserPost) return next();
  const origin = req.header("origin");
  if (!origin || !allowedOrigins.has(origin) || req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw createHttpError("Request rejected by CSRF protection", { code: "CSRF_REJECTED" });
  }
  next();
}
