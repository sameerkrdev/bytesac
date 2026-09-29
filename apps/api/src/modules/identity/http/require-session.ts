import type { ClientKind } from "@repo/contracts";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AppDeps } from "../../../deps.js";
import { SESSION_COOKIE } from "../../../http/security.js";
import { DomainError } from "../../../shared/errors.js";
import { sessionRepo } from "../infra/session-repository.js";

export interface AuthContext { userId: string; sessionId: string; client: ClientKind; transport: "cookie" | "bearer" }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export function readSessionToken(req: Request): { token: string; transport: "cookie" | "bearer" } | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (m) return { token: m[1]!, transport: "bearer" };
  const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
  return cookie ? { token: cookie, transport: "cookie" } : null;
}

async function resolve(deps: AppDeps, req: Request): Promise<AuthContext> {
  const t = readSessionToken(req);
  if (!t) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
  const found = await sessionRepo.findActiveByToken(deps.db, t.token, deps.env.SESSION_TOKEN_PEPPER);
  if (!found) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
  if (found.userStatus !== "active") throw new DomainError("USER_NOT_ACTIVE", "This account is not active");
  await sessionRepo.touch(deps.db, found.session.id, found.session.client);
  return { userId: found.session.userId, sessionId: found.session.id, client: found.session.client, transport: t.transport };
}

export function requireSession(deps: AppDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.auth = await resolve(deps, req);
    next();
  };
}

export function optionalSession(deps: AppDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (readSessionToken(req)) {
      try { req.auth = await resolve(deps, req); } catch { req.auth = undefined; }
    }
    next();
  };
}
