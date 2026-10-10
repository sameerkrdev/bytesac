import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { PREVIEW_GATE_COOKIE } from "@repo/validator";
import { issuePreviewGateToken } from "@/lib/preview-gate-token";

describe("previewGateGuard", () => {
  it("allows /health when gate is enabled", async () => {
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", "g".repeat(32));
    vi.stubEnv("PREVIEW_GATE_EMAIL", "team@bytesac.com");
    vi.stubEnv("PREVIEW_GATE_PASSWORD", "secret-password");
    vi.resetModules();
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard({ path: "/health", cookies: {} } as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("blocks without a preview cookie", async () => {
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", "g".repeat(32));
    vi.stubEnv("PREVIEW_GATE_EMAIL", "team@bytesac.com");
    vi.stubEnv("PREVIEW_GATE_PASSWORD", "secret-password");
    vi.resetModules();
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const next = vi.fn();
    previewGateGuard({ path: "/v1/me", cookies: {} } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "PREVIEW_GATE_REQUIRED" });
    vi.unstubAllEnvs();
  });

  it("passes with a valid preview cookie", async () => {
    const secret = "g".repeat(32);
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", secret);
    vi.stubEnv("PREVIEW_GATE_EMAIL", "team@bytesac.com");
    vi.stubEnv("PREVIEW_GATE_PASSWORD", "secret-password");
    vi.resetModules();
    const { previewGateGuard } = await import("@/middlewares/preview-gate.middleware");
    const token = issuePreviewGateToken(secret).token;
    const next = vi.fn();
    previewGateGuard({ path: "/v1/me", cookies: { [PREVIEW_GATE_COOKIE]: token } } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    vi.unstubAllEnvs();
  });
});
