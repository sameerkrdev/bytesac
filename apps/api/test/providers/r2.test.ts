import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

describe("r2 presigned upload", () => {
  it("signs content-length and content-type and carries no checksum of the empty body", async () => {
    // The suite mocks these two modules globally; this test needs the real client and presigner.
    const { r2, R2_BUCKET } = await vi.importActual<typeof import("../../src/providers/r2")>("../../src/providers/r2");
    const { getSignedUrl } = await vi.importActual<typeof import("@aws-sdk/s3-request-presigner")>("@aws-sdk/s3-request-presigner");
    const url = new URL(await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: "incoming/o/d", ContentType: "application/pdf", ContentLength: 1234 }), {
      expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]),
    }));
    expect([...url.searchParams.keys()].filter((k) => k.toLowerCase().includes("checksum"))).toEqual([]);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
  });
});
