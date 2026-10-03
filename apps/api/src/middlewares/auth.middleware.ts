import createHttpError, { isHttpError } from "http-errors";
import type { NextFunction, Request, Response } from "express";
import { db } from "@repo/db";
import { SESSION_COOKIE, type ClientKind } from "@repo/validator";
import { env } from "@/config/dotenv";
import { activeRoles } from "@/modules/manager-applications/platform-roles.service";
import { findActiveSession, touchSession } from "@/modules/auth/sessions.service";

export interface AuthContext { userId: string; sessionId: string; client: ClientKind; transport: "cookie" | "bearer" }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

function readSessionToken(req: Request): { token: string; transport: "cookie" | "bearer" } | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (m) return { token: m[1]!, transport: "bearer" };
  const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
  return cookie ? { token: cookie, transport: "cookie" } : null;
}

async function resolve(req: Request): Promise<AuthContext> {
  const t = readSessionToken(req);
  const expired = () => createHttpError("Please sign in again", { code: "SESSION_EXPIRED" });
  if (!t) throw expired();
  const found = await findActiveSession(db, t.token, env.SESSION_TOKEN_PEPPER);
  if (!found) throw expired();
  if (found.userStatus !== "active") throw createHttpError("This account is not active", { code: "USER_NOT_ACTIVE" });
  await touchSession(db, found.session.id, found.session.client);
  return { userId: found.session.userId, sessionId: found.session.id, client: found.session.client, transport: t.transport };
}

export async function requireSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.auth = await resolve(req);
  next();
}

/** Invalid or missing sessions are anonymous; infrastructure errors still propagate. */
export async function optionalSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (readSessionToken(req)) {
    try {
      req.auth = await resolve(req);
    } catch (e) {
      if (!isHttpError(e)) throw e;
    }
  }
  next();
}

/** Use after requireSession. Roles are read from the database on every request so a revocation applies immediately; ops_admin also satisfies ops_reviewer. */
export const requireRole = (role: "ops_reviewer" | "ops_admin") => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const held = await activeRoles(db, req.auth!.userId);
  if (!held.includes("ops_admin") && !held.includes(role)) throw createHttpError("You don't have access to this area.", { code: "FORBIDDEN" });
  next();
};
