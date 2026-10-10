// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { safeNext, SURFACE_HEADER } from "@/lib/surface";

const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("MARKETING_HOST", "bytesac.com");
    vi.stubEnv("APP_HOST", "app.bytesac.com");
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", "g".repeat(32));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rewrites the apex home to the waitlist and marks the marketing surface", () => {
    const res = proxy(req("https://bytesac.com/"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://bytesac.com/waitlist");
    expect(res.headers.get(`x-middleware-request-${SURFACE_HEADER}`)).toBe("marketing");
  });

  it("serves explainer pages on the apex", () => {
    const res = proxy(req("https://bytesac.com/how-it-works"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get(`x-middleware-request-${SURFACE_HEADER}`)).toBe("marketing");
  });

  it("sends other apex paths to the app host", () => {
    expect(proxy(req("https://bytesac.com/baskets?f=x")).headers.get("location")).toBe("https://app.bytesac.com/baskets?f=x");
  });

  it("never gates or redirects public files", () => {
    for (const path of ["/visuals/sky/clouds-1600.webp", "/brand/bytesac-logo.png", "/favicon.ico"]) {
      expect(proxy(req(`https://bytesac.com${path}`)).headers.get("location")).toBeNull();
      expect(proxy(req(`https://app.bytesac.com${path}`)).headers.get("location")).toBeNull();
    }
  });

  it("gates the app host and keeps the query in next", () => {
    const loc = new URL(proxy(req("https://app.bytesac.com/baskets?f=x")).headers.get("location")!);
    expect(loc.pathname).toBe("/preview-access");
    expect(loc.searchParams.get("next")).toBe("/baskets?f=x");
  });

  it("drops a client-sent surface header on the app host", () => {
    vi.stubEnv("PREVIEW_GATE_JWT_SECRET", "");
    const res = proxy(req("https://app.bytesac.com/home", { [SURFACE_HEADER]: "marketing" }));
    expect(res.headers.get(`x-middleware-request-${SURFACE_HEADER}`)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/baskets?f=1")).toBe("/baskets?f=1");
    expect(safeNext("/help/wallets#move")).toBe("/help/wallets#move");
  });
  it("refuses off-site and empty values", () => {
    for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/ /evil.com", "javascript:alert(1)"]) expect(safeNext(bad)).toBe("/home");
  });
});
