import type { ClientKind } from "@repo/contracts";
import type { Response } from "express";
import type { Env } from "../../../config/env.js";
import { SESSION_COOKIE } from "../../../http/security.js";
import type { IssuedSession } from "../infra/session-repository.js";

export function setSessionCookie(res: Response, env: Env, issued: IssuedSession): void {
  res.cookie(SESSION_COOKIE, issued.token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: issued.absoluteExpiresAt,
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: "lax", path: "/" });
}

/** Web gets an httpOnly cookie; mobile gets the token in the body. `null` = keep the current session. */
export function respondWithSession(res: Response, env: Env, client: ClientKind, issued: IssuedSession | null): { token?: string } {
  if (!issued) return {};
  if (client === "web") {
    setSessionCookie(res, env, issued);
    return {};
  }
  return { token: issued.token };
}
