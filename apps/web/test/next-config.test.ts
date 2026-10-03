import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.js";

describe("next.config headers", () => {
  it("sets HSTS, Permissions-Policy and a report-only CSP", async () => {
    const rules = await (nextConfig as { headers(): Promise<{ headers: { key: string; value: string }[] }[]> }).headers();
    const h = Object.fromEntries(rules.flatMap((r) => r.headers).map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(h["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(h["Content-Security-Policy-Report-Only"]).toContain("frame-ancestors 'none'");
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(h["Content-Security-Policy-Report-Only"]).toContain(d);
    expect(h["Content-Security-Policy-Report-Only"]).toContain("script-src 'self' 'unsafe-inline' https://www.gstatic.com");
    expect(h["Content-Security-Policy-Report-Only"]).toContain("https://fcmregistrations.googleapis.com");
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });
});
