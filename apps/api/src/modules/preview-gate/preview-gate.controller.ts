import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { PREVIEW_GATE_COOKIE, type PreviewGateLoginRequest } from "@repo/validator";
import { issuePreviewGateToken } from "@/lib/preview-gate-token";
import { env, previewGateEnabled } from "@/config/dotenv";

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
});

export async function loginPreviewGate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!previewGateEnabled()) throw createHttpError("Preview access is not enabled", { code: "NOT_FOUND" });
    const body = req.body as PreviewGateLoginRequest;
    if (body.email.trim().toLowerCase() !== env.PREVIEW_GATE_EMAIL.trim().toLowerCase() || body.password !== env.PREVIEW_GATE_PASSWORD) {
      throw createHttpError("Invalid email or password", { code: "PREVIEW_GATE_DENIED" });
    }
    const issued = issuePreviewGateToken(env.PREVIEW_GATE_JWT_SECRET);
    res.cookie(PREVIEW_GATE_COOKIE, issued.token, { ...cookieOptions(), expires: issued.expiresAt });
    res.json({ ok: true as const, expiresAt: issued.expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
}

export async function logoutPreviewGate(_req: Request, res: Response) {
  res.clearCookie(PREVIEW_GATE_COOKIE, cookieOptions());
  res.json({ ok: true as const });
}
