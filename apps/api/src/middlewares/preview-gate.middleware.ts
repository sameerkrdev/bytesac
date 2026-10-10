import createHttpError from "http-errors";
import type { NextFunction, Request, Response } from "express";
import { PREVIEW_GATE_COOKIE, PREVIEW_GATE_HEADER } from "@repo/validator";
import { verifyPreviewGateToken } from "@/lib/preview-gate-token";
import { env } from "@/config/dotenv";

/** All three env values set: the gate is on. Lives here (not in dotenv.ts) so tests that mock `env` keep working. */
export const previewGateEnabled = (): boolean =>
  env.PREVIEW_GATE_JWT_SECRET.trim().length >= 32 && env.PREVIEW_GATE_EMAIL.trim().length > 0 && env.PREVIEW_GATE_PASSWORD.length > 0;

const OPEN = new Set(["/health", "/v1/public/waitlist", "/v1/public/waitlist/email", "/v1/preview-gate/login"]);

function normalizePath(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/[/]+$/, "") : lower;
}

/** Blocks the API when preview gate env is set, except health, waitlist join and gate login. Web sends the gate cookie; mobile sends the same token in X-Preview-Token. */
export function previewGateGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!previewGateEnabled()) return next();
  const path = normalizePath(req.path);
  if (OPEN.has(path)) return next();
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[PREVIEW_GATE_COOKIE] ?? req.header(PREVIEW_GATE_HEADER);
  if (verifyPreviewGateToken(token, env.PREVIEW_GATE_JWT_SECRET)) return next();
  next(createHttpError("Preview access required", { code: "PREVIEW_GATE_REQUIRED" }));
}
