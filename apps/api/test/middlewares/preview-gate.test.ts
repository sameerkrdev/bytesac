import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ERROR_HTTP_STATUS, PREVIEW_GATE_COOKIE, PREVIEW_GATE_HEADER } from "@repo/validator";
import { issuePreviewGateToken } from "@/lib/preview-gate-token";

const secret = "g".repeat(32);
const req = (path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  ({ path, cookies, header: (n: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] }) as unknown as Request;

describe("previewGateGuard", () => {
  beforeEach(() => {
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", secret);
    vi.stubEnv("PREVIEW_GATE_EMAIL", "team@bytesac.com");
    vi.stubEnv("PREVIEW_GATE_PASSWORD", "secret-password");
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows /health when gate is enabled", async () => {
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard(req("/health"), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks without a preview token with a 401 code", async () => {
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard(req("/v1/me"), {} as Response, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "PREVIEW_GATE_REQUIRED" });
    expect(ERROR_HTTP_STATUS.PREVIEW_GATE_REQUIRED).toBe(401);
  });

  it("passes with a valid preview cookie", async () => {
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard(req("/v1/me", { [PREVIEW_GATE_COOKIE]: issuePreviewGateToken(secret).token }), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes with a valid X-Preview-Token header (mobile)", async () => {
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard(req("/v1/me", {}, { [PREVIEW_GATE_HEADER]: issuePreviewGateToken(secret).token }), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks a forged header token", async () => {
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard(req("/v1/me", {}, { [PREVIEW_GATE_HEADER]: issuePreviewGateToken("x".repeat(32)).token }), {} as Response, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "PREVIEW_GATE_REQUIRED" });
  });
});

describe("loginPreviewGate", () => {
  beforeEach(() => {
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", secret);
    vi.stubEnv("PREVIEW_GATE_EMAIL", "team@bytesac.com");
    vi.stubEnv("PREVIEW_GATE_PASSWORD", "secret-password");
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  const res = () => ({ cookie: vi.fn(), json: vi.fn() });
  const login = (body: object, headers: Record<string, string> = {}) => ({ ...req("/v1/preview-gate/login", {}, headers), body }) as unknown as Request;

  it("refuses a wrong password with PREVIEW_GATE_DENIED (401)", async () => {
    const { loginPreviewGate } = await import("@/modules/preview-gate/preview-gate.controller");
    const next = vi.fn();
    const r = res();
    await loginPreviewGate(login({ email: "team@bytesac.com", password: "nope" }), r as unknown as Response, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "PREVIEW_GATE_DENIED" });
    expect(ERROR_HTTP_STATUS.PREVIEW_GATE_DENIED).toBe(401);
    expect(r.cookie).not.toHaveBeenCalled();
  });

  it("sets the cookie for the web and returns no token", async () => {
    const { loginPreviewGate } = await import("@/modules/preview-gate/preview-gate.controller");
    const r = res();
    await loginPreviewGate(login({ email: " Team@Bytesac.com ", password: "secret-password" }), r as unknown as Response, vi.fn());
    expect(r.cookie).toHaveBeenCalledWith(PREVIEW_GATE_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(r.json.mock.calls[0]?.[0]).not.toHaveProperty("token");
  });

  it("returns the token in the body for mobile and sets no cookie", async () => {
    const { loginPreviewGate } = await import("@/modules/preview-gate/preview-gate.controller");
    const r = res();
    await loginPreviewGate(login({ email: "team@bytesac.com", password: "secret-password" }, { "X-Client": "mobile" }), r as unknown as Response, vi.fn());
    expect(r.cookie).not.toHaveBeenCalled();
    expect(r.json.mock.calls[0]?.[0]).toMatchObject({ ok: true, token: expect.any(String) });
  });
});
