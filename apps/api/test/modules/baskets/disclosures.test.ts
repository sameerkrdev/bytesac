import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../../helpers/db";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb, user } from "../organizations/helpers";
import { activeInstrument, basketOrg, createBasket, post, saveOpen, submitBasket, validContent } from "./helpers";

let admin: { h: Record<string, string> };
let reviewer: { h: Record<string, string> };

beforeAll(async () => {
  await resetOrgDb();
  admin = await opsUser(app, "ops_admin");
  reviewer = await opsUser(app, "ops_reviewer");
});
beforeEach(() => redis.flushdb());

const list = (h: Record<string, string>) => request(app).get("/v1/ops/disclosure-templates").set(h);
const body = { key: "no_guarantee", title: "No guarantee (v2)", body: "Updated wording.", condition: "always" };

describe("disclosure templates", () => {
  it("lists the seeded templates grouped by key, each active at version 1", async () => {
    const res = await list(admin.h);
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { key: string }) => g.key)).toEqual(["fees_and_costs", "no_guarantee", "platform_fee", "rwa_issuer_transfer_redemption", "self_custody_wallet", "stablecoin_depeg", "user_consent_rebalance"]);
    for (const g of res.body.groups) expect(g.templates).toMatchObject([{ version: 1, status: "active" }]);
    expect(res.body.groups[0].templates[0].body).toMatch(/^Placeholder — final wording pending compliance review\./);
    expect(res.body.groups.find((g: { key: string }) => g.key === "stablecoin_depeg").templates[0].condition).toBe("has_stablecoin");
  });

  it("creating a key creates its next version and retires the previous active one; a new key starts at 1", async () => {
    const res = await post(admin.h, "/v1/ops/disclosure-templates", body);
    expect(res.status).toBe(201);
    const group = res.body.groups.find((g: { key: string }) => g.key === "no_guarantee");
    expect(group.templates.map((t: { version: number; status: string }) => [t.version, t.status])).toEqual([[2, "active"], [1, "retired"]]);
    expect(group.templates[1].retiredAt).toBeTruthy();
    const fresh = await post(admin.h, "/v1/ops/disclosure-templates", { key: "tax_notice", title: "Tax", body: "Taxes may apply.", condition: "always" });
    expect(fresh.body.groups.find((g: { key: string }) => g.key === "tax_notice").templates).toMatchObject([{ version: 1, status: "active" }]);
    const audit = await adminSql`SELECT metadata FROM app.audit_events WHERE action = 'disclosure_template.created' ORDER BY created_at`;
    expect(audit.map((a) => (a.metadata as { key: string; version: number }).version)).toEqual([2, 1]);
  });

  it("two simultaneous creations of one key end with exactly one active version", async () => {
    const results = await Promise.all([1, 2].map((n) => post(admin.h, "/v1/ops/disclosure-templates", { ...body, key: "race_notice", title: `Race ${n}` })));
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const rows = await adminSql<{ version: number; status: string }[]>`SELECT version, status FROM app.disclosure_templates WHERE key = 'race_notice' ORDER BY version`;
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("retires a template; a retired one is no longer pinned at submit", async () => {
    const before = (await list(admin.h)).body.groups.find((g: { key: string }) => g.key === "platform_fee").templates[0].id as string;
    const res = await post(admin.h, `/v1/ops/disclosure-templates/${before}/retire`);
    expect(res.status).toBe(200);
    expect(res.body.groups.find((g: { key: string }) => g.key === "platform_fee").templates[0].status).toBe("retired");
    expect((await post(admin.h, `/v1/ops/disclosure-templates/${before}/retire`)).status).toBe(409);
    expect((await post(admin.h, "/v1/ops/disclosure-templates/11111111-1111-4111-8111-111111111111/retire")).status).toBe(404);

    const ctx = await basketOrg();
    const [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
    const bk = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, bk.id, validContent(a, b));
    const submitted = await submitBasket(ctx.owner.h, bk.id);
    expect(submitted.body.openVersion.disclosures.map((d: { key: string }) => d.key)).not.toContain("platform_fee");
  });

  it("validates the body and keeps the editor to ops_admin", async () => {
    for (const bad of [{ ...body, key: "NO" }, { ...body, title: "" }, { ...body, condition: "sometimes" }, { ...body, extra: 1 }]) {
      expect((await post(admin.h, "/v1/ops/disclosure-templates", bad)).status).toBe(400);
    }
    const [seed] = await adminSql<{ id: string }[]>`SELECT id FROM app.disclosure_templates WHERE key = 'fees_and_costs' AND status = 'active'`;
    expect((await list(reviewer.h)).status).toBe(403);
    expect((await post(reviewer.h, "/v1/ops/disclosure-templates", body)).status).toBe(403);
    expect((await post(reviewer.h, `/v1/ops/disclosure-templates/${seed!.id}/retire`)).status).toBe(403);
    const plain = await user(app, false);
    expect((await list(plain.h)).status).toBe(403);
    expect((await adminSql`SELECT 1 FROM app.disclosure_templates WHERE key = 'fees_and_costs' AND status = 'active'`)).toHaveLength(1);
  });
});
