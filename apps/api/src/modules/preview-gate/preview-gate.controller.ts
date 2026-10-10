import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { CLIENT_HEADER, MOBILE_CLIENT, PREVIEW_GATE_COOKIE, type PreviewGateLoginRequest } from "@repo/validator";
import { issuePreviewGateToken } from "@/lib/preview-gate-token";
import { env, previewGateEnabled } from "@/config/dotenv";

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
});

/** Constant-time compare: digests have equal length whatever the input. */
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function loginPreviewGate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!previewGateEnabled()) throw createHttpError("Preview access is not enabled", { code: "NOT_FOUND" });
    const body = req.body as PreviewGateLoginRequest;
    const emailOk = same(body.email.trim().toLowerCase(), env.PREVIEW_GATE_EMAIL.trim().toLowerCase());
    const passwordOk = same(body.password, env.PREVIEW_GATE_PASSWORD);
    if (!emailOk || !passwordOk) throw createHttpError("Invalid email or password", { code: "PREVIEW_GATE_DENIED" });
    const issued = issuePreviewGateToken(env.PREVIEW_GATE_JWT_SECRET);
    // Mobile has no cookie jar: it gets the token in the body and sends it back as X-Preview-Token.
    const mobile = req.header(CLIENT_HEADER) === MOBILE_CLIENT;
    if (!mobile) res.cookie(PREVIEW_GATE_COOKIE, issued.token, { ...cookieOptions(), expires: issued.expiresAt });
    res.json({ ok: true as const, expiresAt: issued.expiresAt.toISOString(), ...(mobile ? { token: issued.token } : {}) });
  } catch (err) {
    next(err);
  }
}

export async function logoutPreviewGate(_req: Request, res: Response) {
  res.clearCookie(PREVIEW_GATE_COOKIE, cookieOptions());
  res.json({ ok: true as const });
}
