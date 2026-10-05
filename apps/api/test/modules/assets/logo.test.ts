import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { activeCrypto, admin, get, mkAsset, plainUser, post, reviewer } from "./helpers";

beforeEach(resetDb);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const padded = (head: Buffer, size: number) => Buffer.concat([head, Buffer.alloc(size - head.length)]);

/** Presigns, "uploads" `bytes` to the fake bucket, and confirms. */
async function upload(h: Record<string, string>, id: string, bytes: Buffer, contentType = "image/png") {
  const pre = await post(h, `/v1/ops/assets/${id}/logo`, { contentType, sizeBytes: bytes.length });
  expect(pre.status).toBe(201);
  fakes.r2.put(`incoming/files/instrument_logo/${pre.body.fileId}`, bytes, contentType);
  return { pre, res: await post(h, `/v1/ops/assets/${id}/logo/${pre.body.fileId}/confirm`) };
}

describe("instrument logo", () => {
  it("stores a checked PNG under its final key, links it, audits it and shows a signed URL", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const { pre, res } = await upload(r.h, id, padded(PNG, 300));
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(`https://r2.test/files/instrument_logo/${pre.body.fileId}.png?sig`);
    expect([...fakes.r2.objects.keys()]).toEqual([`files/instrument_logo/${pre.body.fileId}.png`]);
    const [audit] = await adminSql<{ action: string }[]>`SELECT action FROM app.audit_events WHERE entity_id = ${id} AND action = 'instrument.logo_set'`;
    expect(audit).toBeDefined();
    expect((await get(r.h, "/v1/ops/assets")).body.items[0].logoUrl).toBe(res.body.logoUrl);
  });

  it("accepts WebP, replaces the previous logo, and clears it", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    await upload(r.h, id, padded(PNG, 64));
    const { pre, res } = await upload(r.h, id, padded(WEBP, 64), "image/webp");
    expect(res.body.logoUrl).toContain(`${pre.body.fileId}.webp`);
    const cleared = await request(app).delete(`/v1/ops/assets/${id}/logo`).set(r.h);
    expect(cleared.status).toBe(200);
    expect(cleared.body.logoUrl).toBeNull();
  });

  it("rejects a file whose bytes don't match its declared type, and cannot confirm twice", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const { pre, res } = await upload(r.h, id, padded(Buffer.from("<svg>"), 64));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("DOCUMENT_REJECTED");
    expect(fakes.r2.objects.size).toBe(0);
    expect((await post(r.h, `/v1/ops/assets/${id}/logo/${pre.body.fileId}/confirm`)).body.error.code).toBe("INVALID_TRANSITION");
  });

  it("validates type and size, and only the uploader can confirm", async () => {
    const r = await reviewer();
    const other = await reviewer();
    const id = await mkAsset(r.h);
    expect((await post(r.h, `/v1/ops/assets/${id}/logo`, { contentType: "image/svg+xml", sizeBytes: 100 })).status).toBe(400);
    expect((await post(r.h, `/v1/ops/assets/${id}/logo`, { contentType: "image/png", sizeBytes: 600 * 1024 })).status).toBe(400);
    const pre = await post(r.h, `/v1/ops/assets/${id}/logo`, { contentType: "image/png", sizeBytes: 64 });
    fakes.r2.put(`incoming/files/instrument_logo/${pre.body.fileId}`, padded(PNG, 64), "image/png");
    expect((await post(other.h, `/v1/ops/assets/${id}/logo/${pre.body.fileId}/confirm`)).status).toBe(404);
  });

  it("is ops-only to change, and visible on the public asset views", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    const live = await activeCrypto(r, a);
    expect((await post(u.h, `/v1/ops/assets/${live.id}/logo`, { contentType: "image/png", sizeBytes: 64 })).status).toBe(403);
    const { res } = await upload(r.h, live.id, padded(PNG, 64));
    expect((await get(u.h, `/v1/assets/${live.id}`)).body.logoUrl).toBe(res.body.logoUrl);
    expect((await get(u.h, "/v1/assets")).body.items[0].logoUrl).toBe(res.body.logoUrl);
  });
});
