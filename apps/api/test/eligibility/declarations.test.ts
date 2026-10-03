import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { ELIGIBILITY_ATTESTATION } from "@repo/validator";
import { admin, mkAsset, mkDeployment, mkRule, patch, plainUser, reviewer } from "../assets/helpers";
import { seedBasket, seedUser } from "../execution/helpers";
import { webHeaders } from "../helpers/auth";
import { adminSql, resetDb } from "../helpers/db";
import { refreshSearchIndex } from "../../src/services/search-index";

// The geo header name is switchable per test (the parsed env is read-only).
const geo = vi.hoisted(() => ({ header: "" }));
vi.mock("../../src/env", async (original) => {
  const m = await original<typeof import("../../src/env")>();
  return { ...m, env: new Proxy({} as typeof m.env, { get: (_, k) => (k === "GEO_COUNTRY_HEADER" ? geo.header : Reflect.get(m.env, k)) }) };
});

type H = Record<string, string>;
const declaration = (over: object = {}) => ({ country: "DE", investorStatus: "retail", attestationVersion: ELIGIBILITY_ATTESTATION.version, ...over });
const declare = (h: H, body: object = declaration()) => request(app).post("/v1/me/eligibility").set(h).send(body);
const rows = () => adminSql<{ country: string; investor_status: string; attestation_version: string; ip_country: string | null; created_at: Date }[]>`SELECT * FROM app.eligibility_declarations ORDER BY created_at, id`;

beforeEach(async () => {
  geo.header = "";
  await resetDb();
});

describe("POST /v1/me/eligibility", () => {
  it("validates country, status and the current attestation version", async () => {
    const u = await plainUser();
    for (const bad of [{ country: "de" }, { country: "DEU" }, { investorStatus: "whale" }, { attestationVersion: "2020-01-01" }, { extra: 1 }]) {
      const res = await declare(u.h, declaration(bad));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect(await rows()).toHaveLength(0);
    expect((await request(app).post("/v1/me/eligibility").send(declaration())).status).toBe(401);
  });

  it("appends a row (never an edit) with the geo signal, and audits it", async () => {
    geo.header = "CF-IPCountry";
    const u = await plainUser();
    const first = await declare(u.h).set("CF-IPCountry", "fr");
    expect(first.status).toBe(201);
    expect(first.body.declaration).toMatchObject({ country: "DE", investorStatus: "retail", attestationVersion: "2026-10-03", expired: false });
    await declare(u.h, declaration({ country: "FR", investorStatus: "accredited" }));
    expect((await rows()).map((r) => [r.country, r.investor_status, r.ip_country])).toEqual([["DE", "retail", "FR"], ["FR", "accredited", null]]);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'eligibility.declared' AND actor_user_id = ${u.userId}`).toHaveLength(2);
  });

  it("ignores the geo header while GEO_COUNTRY_HEADER is unset (Review Focus 3)", async () => {
    const u = await plainUser();
    await declare(u.h).set("CF-IPCountry", "FR");
    expect((await rows())[0]!.ip_country).toBeNull();
  });

  it("the 11th declaration in a day is 429", async () => {
    const u = await plainUser();
    for (let n = 0; n < 10; n++) expect((await declare(u.h)).status).toBe(201);
    expect((await declare(u.h)).status).toBe(429);
    expect(await rows()).toHaveLength(10);
  });
});

describe("GET /v1/me/eligibility", () => {
  it("returns null, then the latest declaration with its expiry, then expired after 365 days", async () => {
    const u = await plainUser();
    expect((await request(app).get("/v1/me/eligibility").set(u.h)).body).toEqual({ declaration: null });
    await declare(u.h);
    const { declaration: d } = (await request(app).get("/v1/me/eligibility").set(u.h)).body;
    expect(d).toMatchObject({ country: "DE", expired: false });
    expect(Date.parse(d.expiresAt) - Date.parse(d.createdAt)).toBe(365 * 86_400_000);
    await adminSql`UPDATE app.eligibility_declarations SET created_at = now() - interval '366 days'`;
    expect((await request(app).get("/v1/me/eligibility").set(u.h)).body.declaration).toMatchObject({ expired: true });
  });
});

describe("ops: investor statuses, permissioned, review warning", () => {
  it("the rule editor accepts investorStatuses on create and update, and audits the change", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "T-Bill Fund", symbol: "TBF", assetType: "TOKENIZED_TREASURY" });
    const created = await mkRule(r.h, id, { jurisdiction: "DE", investorStatuses: ["accredited", "professional"] });
    expect(created.body.rules[0]).toMatchObject({ investorStatuses: ["accredited", "professional"] });
    expect((await mkRule(r.h, id, { jurisdiction: "FR" })).body.rules[1].investorStatuses).toEqual([]);
    const ruleId = created.body.rules[0].id;
    const updated = await patch(r.h, `/v1/ops/assets/${id}/rules/${ruleId}`, { investorStatuses: ["retail"] });
    expect(updated.status).toBe(200);
    expect(updated.body.rules[0].investorStatuses).toEqual(["retail"]);
    expect((await patch(r.h, `/v1/ops/assets/${id}/rules/${ruleId}`, { investorStatuses: ["nope"] })).status).toBe(400);
    const [event] = await adminSql<{ metadata: { fields: string[] } }[]>`SELECT metadata FROM app.audit_events WHERE action = 'asset.rule.updated' AND entity_id = ${ruleId}`;
    expect(event!.metadata.fields).toContain("investorStatuses");
  });

  it("only ops_admin sets permissioned, and it is audited", async () => {
    const [r, a] = [await reviewer(), await admin()];
    const id = await mkAsset(r.h, { name: "T-Bill Fund", symbol: "TBF", assetType: "TOKENIZED_TREASURY" });
    const did = await mkDeployment(r.h, id);
    const path = `/v1/ops/assets/${id}/deployments/${did}/permissioned`;
    expect((await patch(r.h, path, { permissioned: true })).status).toBe(403);
    const res = await patch(a.h, path, { permissioned: true });
    expect(res.status).toBe(200);
    expect(res.body.deployments[0].permissioned).toBe(true);
    expect((await patch(a.h, path, { permissioned: "yes" })).status).toBe(400);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'asset.deployment.updated' AND metadata->>'permissioned' = 'true'`).toHaveLength(1);
    expect((await patch(a.h, path, { permissioned: false })).body.deployments[0].permissioned).toBe(false);
  });

  it("the review view warns about an RWA without an ACTIVE rule", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "T-Bill Fund", symbol: "TBF", assetType: "TOKENIZED_TREASURY" });
    const view = async () => (await request(app).get(`/v1/ops/assets/${id}`).set(r.h)).body;
    expect((await view()).warnings).toEqual(["Restricted everywhere until eligibility rules exist."]);
    await mkRule(r.h, id);
    expect((await view()).warnings).toEqual([]);
    const crypto = await mkAsset(r.h, { name: "Solana", symbol: "sol", assetType: "CRYPTO" });
    expect((await request(app).get(`/v1/ops/assets/${crypto}`).set(r.h)).body.warnings).toEqual([]);
  });
});

describe("basket pages", () => {
  async function rwaBasket() {
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 6000 }, { symbol: "BOND", chain: "solana", tokenStandard: "spl", decimals: 6, bps: 4000, assetType: "TOKENIZED_TREASURY" }] });
    return { basket, bond: basket.deployments[1]! };
  }

  it("public detail: signed out only says requirements exist; signed in shows the viewer's outcome per tokenized asset", async () => {
    const { basket, bond } = await rwaBasket();
    const out = await request(app).get(`/v1/public/baskets/${basket.slug}`);
    expect(out.status).toBe(200);
    expect(out.body.eligibility).toEqual({ requirements: true });

    const user = await seedUser();
    const noDeclaration = await request(app).get(`/v1/public/baskets/${basket.slug}`).set(user.h);
    expect(noDeclaration.body.eligibility).toEqual({ requirements: true, assets: [{ instrumentId: bond.instrumentId, outcome: "DECLARATION_REQUIRED", reason: "DECLARATION_REQUIRED" }] });

    await adminSql`INSERT INTO app.eligibility_declarations (id, user_id, country, investor_status, attestation_version) VALUES (gen_random_uuid(), ${user.userId}, 'DE', 'retail', '2026-10-03')`;
    const restricted = await request(app).get(`/v1/public/baskets/${basket.slug}`).set(user.h);
    expect(restricted.body.eligibility.assets).toEqual([{ instrumentId: bond.instrumentId, outcome: "RESTRICTED", reason: "NO_RULE" }]);
    await adminSql`INSERT INTO app.eligibility_rules (id, instrument_id, jurisdiction, action, outcome, status) VALUES (gen_random_uuid(), ${bond.instrumentId}, 'DE', 'acquire', 'ALLOWED', 'ACTIVE')`;
    expect((await request(app).get(`/v1/public/baskets/${basket.slug}`).set(user.h)).body.eligibility.assets).toEqual([{ instrumentId: bond.instrumentId, outcome: "ALLOWED", reason: "RULE" }]);
  });

  it("a crypto-only basket has no requirements", async () => {
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    expect((await request(app).get(`/v1/public/baskets/${basket.slug}`).set(webHeaders())).body.eligibility).toEqual({ requirements: false });
  });

  it("the discovery card says whether the basket holds tokenized assets", async () => {
    const { basket } = await rwaBasket();
    await refreshSearchIndex(basket.basketId);
    const items = (await request(app).get("/v1/public/discovery/baskets")).body.items as { slug: string; hasEligibilityRequirements: boolean }[];
    expect(items.find((i) => i.slug === basket.slug)?.hasEligibilityRequirements).toBe(true);
  });
});
