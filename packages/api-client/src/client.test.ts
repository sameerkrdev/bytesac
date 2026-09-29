import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("api client", () => {
  it("cookie transport sends credentials and CSRF header", async () => {
    const f = vi.fn(async () => jsonResponse(200, { challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", message: "m", expiresAt: "2026-01-01T00:00:00.000Z" }));
    const api = createApiClient({ baseUrl: "/api", transport: { kind: "cookie" }, fetch: f });
    await api.createChallenge({ purpose: "sign_in", chain: "base", address: "0xabc" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/challenge");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("bytesac");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });

  it("bearer transport adds Authorization and omits credentials", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: "https://api.test", transport: { kind: "bearer", getToken: async () => "tok" }, fetch: f });
    await api.logout();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/auth/logout");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(new Headers(init.headers).get("X-Client")).toBe("mobile");
  });

  it("maps error bodies to ApiError with retry-after", async () => {
    const f = vi.fn(async () => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "slow down" } }, { "retry-after": "12" }));
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("RATE_LIMITED");
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).retryAfterSec).toBe(12);
  });

  it("ignores a non-numeric (HTTP-date) retry-after", async () => {
    const f = vi.fn(async () => jsonResponse(503, { error: { code: "RATE_LIMITED", message: "slow down" } }, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    const err = await api.me().catch((e: unknown) => e);
    expect((err as ApiError).retryAfterSec).toBeUndefined();
  });

  it("maps network failures to NETWORK_ERROR", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    const err = await api.me().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("NETWORK_ERROR");
  });

  it("rejects malformed success bodies", async () => {
    const f = vi.fn(async () => jsonResponse(200, { nope: true }));
    const api = createApiClient({ baseUrl: "", transport: { kind: "cookie" }, fetch: f });
    await expect(api.me()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
