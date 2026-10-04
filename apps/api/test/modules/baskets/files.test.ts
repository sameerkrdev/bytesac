import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb } from "../organizations/helpers";
import { activeInstrument, basketOrg, basketRow, createBasket, getBasket, post, publishedBasket, saveOpen, submitBasket, validContent } from "./helpers";

type H = Record<string, string>;
let ctx: Awaited<ReturnType<typeof basketOrg>>;
let admin: { userId: string; h: H };
let a: string;
let b: string;

const PDF = Buffer.from("%PDF-1.7\n");
const pdf = (size = 200) => Buffer.concat([PDF, Buffer.alloc(size - PDF.length)]);

/** Presigns, "uploads" `bytes` to the fake bucket and confirms with a title. */
async function attach(h: H, bid: string, bytes = pdf(), title = "Investment thesis", contentType = "application/pdf") {
  const pre = await post(h, `/v1/baskets/${bid}/draft/files`, { fileName: "../../etc/Thesis Q3.pdf", contentType, sizeBytes: bytes.length });
  if (pre.status !== 201) return { pre, res: pre };
  fakes.r2.put(`incoming/files/basket_file/${pre.body.fileId}`, bytes, contentType);
  return { pre, res: await post(h, `/v1/baskets/${bid}/draft/files/${pre.body.fileId}/confirm`, { kind: "thesis", title }) };
}

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  admin = await opsUser(app, "ops_admin");
  [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
});
beforeEach(async () => { await redis.flushdb(); });

describe("basket version files", () => {
  it("attaches a checked PDF to the draft with a safe name and a download link, bumping the revision", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id);
    const { pre, res } = await attach(ctx.owner.h, id);
    expect(res.status).toBe(200);
    expect(res.body.openVersion.revision).toBe(openVersion.revision + 1);
    expect(res.body.openVersion.files).toEqual([{
      id: expect.any(String), kind: "thesis", title: "Investment thesis", fileName: "Thesis Q3.pdf", contentType: "application/pdf", sizeBytes: 200,
      url: `https://r2.test/files/basket_file/${pre.body.fileId}.pdf?sig`, addedAt: expect.any(String),
    }]);
    const signed = fakes.r2.signed.find((s) => s.command === "GetObjectCommand");
    expect(signed?.input.ResponseContentDisposition).toBe('attachment; filename="Thesis Q3.pdf"');
    const [audit] = await adminSql`SELECT 1 FROM app.audit_events WHERE entity_id = ${id} AND action = 'basket.file_added'`;
    expect(audit).toBeDefined();
  });

  it("rejects bytes that aren't a PDF and non-PDF types", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    const { res } = await attach(ctx.owner.h, id, Buffer.concat([Buffer.from("<html>"), Buffer.alloc(100)]));
    expect(res.status).toBe(422);
    expect((await attach(ctx.owner.h, id, pdf(), "x", "image/png")).res.status).toBe(400);
    expect((await getBasket(ctx.owner.h, id)).body.openVersion.files).toEqual([]);
  });

  it("unlinks a file from the draft", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    const { res } = await attach(ctx.owner.h, id);
    const linkId = res.body.openVersion.files[0].id;
    const removed = await request(app).delete(`/v1/baskets/${id}/draft/files/${linkId}`).set(ctx.owner.h);
    expect(removed.status).toBe(200);
    expect(removed.body.openVersion.files).toEqual([]);
    expect((await request(app).delete(`/v1/baskets/${id}/draft/files/${linkId}`).set(ctx.owner.h)).status).toBe(404);
  });

  it("needs edit authority on the basket", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    expect((await attach(ctx.members.VIEWER.h, id)).res.status).toBe(403);
    expect((await attach(ctx.members.ANALYST.h, id)).res.status).toBe(403);
    // A manager without an assignment on this basket can't either.
    expect((await attach(ctx.members.MANAGER.h, id)).res.status).toBe(403);
  });

  it("freezes files once the version is submitted, and carries them into the next draft after publishing", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id, { name: "Files", category: "thematic" });
    await saveOpen(ctx.owner.h, id, validContent(a, b));
    await attach(ctx.owner.h, id);
    expect((await submitBasket(ctx.owner.h, id)).status).toBe(200);
    expect((await attach(ctx.owner.h, id)).res.body.error.code).toBe("INVALID_TRANSITION");

    const live = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Live");
    const firstAttach = await (async () => {
      const next = await post(ctx.owner.h, `/v1/baskets/${live.id}/versions`);
      expect(next.status).toBe(201);
      return attach(ctx.owner.h, live.id, pdf(), "Factsheet");
    })();
    expect(firstAttach.res.status).toBe(200);
    // The published version has none; the open draft has one. Public sees only published files.
    const slug = (await basketRow(live.id)).slug as string;
    expect((await request(app).get(`/v1/public/baskets/${slug}`)).body.files).toEqual([]);
    expect(firstAttach.res.body.publishedVersion.files).toEqual([]);
  });

  it("shows the published version's files on the public page and copies them into the next draft", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id, { name: "Published files", category: "thematic" });
    await saveOpen(ctx.owner.h, id, validContent(a, b));
    await attach(ctx.owner.h, id, pdf(), "Methodology");
    expect((await submitBasket(ctx.owner.h, id)).status).toBe(200);
    expect((await post(admin.h, `/v1/ops/baskets/${id}/versions/${openVersion.id}/decision`, { decision: "approved", checklist: Object.fromEntries(["completeness", "assets", "allocation", "communication", "managers", "fees", "operations"].map((k) => [k, { result: "pass" }])) })).status).toBe(200);
    expect((await post(ctx.owner.h, `/v1/baskets/${id}/publish`)).status).toBe(200);
    const slug = (await basketRow(id)).slug as string;
    const pub = await request(app).get(`/v1/public/baskets/${slug}`);
    expect(pub.body.files).toMatchObject([{ title: "Methodology", kind: "thesis", contentType: "application/pdf" }]);
    const next = await post(ctx.owner.h, `/v1/baskets/${id}/versions`);
    expect(next.body.openVersion.files).toMatchObject([{ title: "Methodology" }]);
    expect(next.body.openVersion.files[0].id).not.toBe(pub.body.files[0].id);
  });
});
