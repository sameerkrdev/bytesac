import createHttpError from "http-errors";
import type { NextFunction, Request, Response } from "express";
import { PREVIEW_GATE_COOKIE } from "@repo/validator";
import { verifyPreviewGateToken } from "@/lib/preview-gate-token";
import { env, previewGateEnabled } from "@/config/dotenv";

const OPEN = new Set(["/health", "/v1/public/waitlist", "/v1/preview-gate/login"]);

function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/[/]+$/, "") : lower;
}

/** Blocks the API when preview gate env is set, except health, waitlist join and gate login. */
export function previewGateGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!previewGateEnabled()) return next();
  const path = normalizePath(req.path);
  if (OPEN.has(path)) return next();
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (verifyPreviewGateToken(cookies?.[PREVIEW_GATE_COOKIE], env.PREVIEW_GATE_JWT_SECRET)) return next();
  next(createHttpError("Preview access required", { code: "PREVIEW_GATE_REQUIRED" }));
}
