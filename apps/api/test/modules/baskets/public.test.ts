import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/config/dotenv", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/config/dotenv")>();
  return { env: { ...env, COINMARKETCAP_API_KEY: "test-cmc-key" } };
});

import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { PAGE_SIZE } from "@/modules/organizations/organization-review.service";
import { adminSql } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { addMember, memberAction } from "../members/helpers";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb, verifiedOrg } from "../organizations/helpers";
import { activeInstrument, basketRow, createBasket, decideBasket, decision, post, publishedBasket, saveOpen, submitBasket, validContent } from "./helpers";

type Org = Awaited<ReturnType<typeof verifiedOrg>>;
let org: Org;
let admin: { userId: string; h: Record<string, string> };
let reviewer: { userId: string; h: Record<string, string> };
let a: string;
let b: string;
let live: { id: string; vid: string };

const get = (path: string) => request(app).get(path);
const slugOf = async (id: string) => (await basketRow(id)).slug as string;

beforeAll(async () => {
  await resetOrgDb();
  reviewer = await opsUser(app, "ops_reviewer");
  admin = await opsUser(app, "ops_admin");
  org = await verifiedOrg(app, reviewer);
  await adminSql`UPDATE app.organization_memberships SET public_display_name = 'Ada Lovelace', public_title = 'Founder' WHERE organization_id = ${org.id} AND role = 'OWNER'`;
  a = await activeInstrument(org.userId, { name: "Alpha Coin" });
  b = await activeInstrument(org.userId, { name: "Beta Coin" });
  await adminSql`INSERT INTO app.price_references (id, instrument_id, kind, provider, external_id, quote_currency, status) VALUES (gen_random_uuid(), ${a}, 'market', 'coinmarketcap', '1027', 'USD', 'ACTIVE')`;
  fakes.cmc.quotes.set("1027", { value: "2500.5", observedAt: new Date().toISOString() });
  live = await publishedBasket(org, org.id, admin, a, b, "Public Basket");
});

/** Every key a public basket response may contain. */
const ALLOWED = new Set([
  "slug", "status", "hasAssetWarning", "organization", "id", "displayName", "version", "versionNumber", "publishedAt", "name", "shortDescription", "longDescription", "category", "tags",
  "objective", "thesis", "methodology", "intendedInvestor", "horizon", "keyAssumptions", "knownLimitations", "strategyRisks", "liquidityNotes", "conflictsOfInterest", "constraints",
  "maxWeightPerAssetBps", "maxStablecoinBps", "maxRwaBps", "rebalance", "reviewFrequency", "driftThresholdBps", "fees", "entry", "management", "subscription", "type", "bps", "amountUsdc",
  "period", "minimumInvestmentUsdc", "minimumIncrementUsdc", "allocation", "instrumentId", "symbol", "assetType", "chains", "targetWeightBps", "minWeightBps", "maxWeightBps", "prices",
  "kind", "value", "currency", "source", "observedAt", "stale", "disclosures", "title", "body", "versionHistory", "rationale", "diff", "added", "removed", "changed", "weightBps", "fromBps",
  "toBps", "bandChanged", "constraints", "rebalance", "minimums", "managers", "role", "from", "to",
  // Spec 7: handle (published profile), performance series and metrics, sectors, tags and the label.
  "handle", "performance", "available", "dataDays", "series", "day", "net", "gross", "metrics", "sinceLaunch", "d30", "d90", "y1", "volatility", "maxDrawdown", "sectors", "sector", "key", "label",
  // Spec 17 round 2: registry logos on the allocation and the published version's files (signed links).
  "logoUrl", "files", "fileName", "contentType", "sizeBytes", "url", "addedAt",
  // Spec 10: the platform fee rate that applies to the basket (no reasons).
  "platformFee", "operationKind", "minUsdc", "maxUsdc",
  // Spec 11: whether tokenized assets need an eligibility declaration (and the signed-in viewer outcomes).
  "eligibility", "requirements", "assets", "outcome", "reason",
]);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

describe("public basket page", () => {
  it("serves the published content with allocation, prices, disclosures, history and managers, and nothing private", async () => {
    const res = await get(`/v1/public/baskets/${await slugOf(live.id)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ACTIVE", hasAssetWarning: false, organization: { id: org.id, displayName: "Ada Capital" },
      version: { versionNumber: 1, name: "Public Basket", shortDescription: "A short description", thesis: "Thesis", minimumInvestmentUsdc: "100", fees: { entry: { type: "percent", bps: 0 } } },
    });
    const alpha = res.body.allocation.find((x: { instrumentId: string }) => x.instrumentId === a);
    expect(alpha).toMatchObject({ name: "Alpha Coin", assetType: "CRYPTO", chains: ["ethereum"], targetWeightBps: 6000, prices: [{ kind: "market", status: "ok", value: "2500.5", source: "coinmarketcap" }] });
    expect(res.body.allocation.find((x: { instrumentId: string }) => x.instrumentId === b).prices).toEqual([]);
    expect(res.body.disclosures.map((d: { title: string }) => d.title)).toEqual(expect.arrayContaining(["No guarantee", "Self-custody wallet"]));
    expect(res.body.versionHistory).toMatchObject([{ versionNumber: 1, rationale: null, diff: { added: [{ instrumentId: expect.any(String) }, { instrumentId: expect.any(String) }] } }]);
    expect(res.body.managers).toMatchObject([{ displayName: "Ada Lovelace", role: "lead", to: null }]);
    expect(keysOf(res.body).filter((k) => !ALLOWED.has(k))).toEqual([]);
    const text = JSON.stringify(res.body);
    const [m] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${org.id} AND role = 'OWNER'`;
    for (const secret of [org.userId, m!.id, "internal", "email", "@example.com", "contentHash", "approvedHash"]) expect(text, secret).not.toContain(secret);
  });

  it("needs no session, and unknown, draft-only and rejected baskets are 404", async () => {
    const draft = await createBasket(org.h, org.id, { name: "Only A Draft", category: "index" });
    const rejected = await createBasket(org.h, org.id, { name: "Will Be Rejected", category: "index" });
    await saveOpen(org.h, rejected.id, validContent(a, b));
    await submitBasket(org.h, rejected.id);
    await decideBasket(reviewer.h, rejected.id, rejected.openVersion.id, decision("rejected", { messageToManager: "No" }));
    for (const slug of [await slugOf(draft.id), await slugOf(rejected.id), "no-such-basket-abc123"]) {
      const res = await get(`/v1/public/baskets/${slug}`);
      expect(res.status, slug).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect((await get("/v1/public/baskets/Not_A_Slug")).status).toBe(400);
  });

  it("flags a paused or deprecated asset without changing anything", async () => {
    const other = await activeInstrument(org.userId, { name: "Gamma" });
    const r = await publishedBasket(org, org.id, admin, a, other, "Warned Basket");
    const slug = await slugOf(r.id);
    expect((await get(`/v1/public/baskets/${slug}`)).body.hasAssetWarning).toBe(false);
    await adminSql`UPDATE app.instruments SET status = 'DEPRECATED' WHERE id = ${other}`;
    const res = await get(`/v1/public/baskets/${slug}`);
    expect(res.body).toMatchObject({ hasAssetWarning: true, status: "ACTIVE" });
    expect(res.body.allocation).toHaveLength(2);
  });

  it("shows the notice status when the lead left (REASSIGNMENT_REQUIRED), with the former lead's span", async () => {
    const lead = await addMember(app, org.id, "MANAGER");
    const r = await publishedBasket(lead, org.id, admin, a, b, "Leaderless Basket");
    expect((await memberAction(app, org.h, org.id, lead.mid, "remove")).status).toBe(200);
    const res = await get(`/v1/public/baskets/${await slugOf(r.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REASSIGNMENT_REQUIRED");
    expect(res.body.managers).toMatchObject([{ displayName: "Team member", role: "lead", to: expect.any(String) }]);
    expect((await get("/v1/public/baskets")).body.items.find((i: { name: string }) => i.name === "Leaderless Basket")).toMatchObject({ status: "REASSIGNMENT_REQUIRED" });
  });

  it("serves a RETIRED basket by its link but does not list it", async () => {
    const r = await publishedBasket(org, org.id, admin, a, b, "Retired Basket");
    expect((await post(admin.h, `/v1/ops/baskets/${r.id}/retire`, { reason: "Done" })).status).toBe(200);
    const res = await get(`/v1/public/baskets/${await slugOf(r.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RETIRED");
    const names = (await get("/v1/public/baskets")).body.items.map((i: { name: string }) => i.name);
    expect(names).not.toContain("Retired Basket");
  });
});

describe("public list", () => {
  it("lists only published baskets in listed statuses, newest first, as cards", async () => {
    const res = await get("/v1/public/baskets");
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ name: string; status: string; publishedAt: string }>;
    const names = items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["Public Basket", "Warned Basket", "Leaderless Basket"]));
    for (const hidden of ["Only A Draft", "Will Be Rejected", "Retired Basket"]) expect(names).not.toContain(hidden);
    expect(items.map((i) => i.publishedAt)).toEqual([...items.map((i) => i.publishedAt)].sort().reverse());
    expect(items.find((i) => i.name === "Public Basket")).toEqual({
      slug: await slugOf(live.id), name: "Public Basket", shortDescription: "A short description", organizationName: "Ada Capital", category: "thematic", assetCount: 2,
      minimumInvestmentUsdc: "100", status: "ACTIVE", publishedAt: expect.any(String),
    });
    await adminSql`UPDATE app.baskets SET status = 'PAUSED' WHERE id = ${live.id}`;
    expect((await get("/v1/public/baskets")).body.items.find((i: { name: string }) => i.name === "Public Basket").status).toBe("PAUSED");
    await adminSql`UPDATE app.baskets SET status = 'ACTIVE' WHERE id = ${live.id}`;
  });

  it("pages with a stable cursor and refuses a bad one", async () => {
    const [listed] = await adminSql<{ count: number }[]>`SELECT count(*)::int AS count FROM app.baskets WHERE current_version_id IS NOT NULL AND status IN ('ACTIVE', 'PAUSED', 'REASSIGNMENT_REQUIRED', 'RETIREMENT_PENDING')`;
    await adminSql`INSERT INTO app.baskets (id, organization_id, slug, status, created_by_user_id) SELECT gen_random_uuid(), ${org.id}, 'bulk-' || n, 'ACTIVE', ${org.userId} FROM generate_series(1, ${PAGE_SIZE + 1}) n`;
    await adminSql`INSERT INTO app.basket_versions (id, basket_id, version_number, status, name, category, fees, created_by_user_id, published_at)
      SELECT gen_random_uuid(), id, 1, 'published', 'Bulk ' || slug, 'index', '{}'::jsonb, ${org.userId}, now() + interval '1 day' FROM app.baskets WHERE slug LIKE 'bulk-%'`;
    await adminSql`UPDATE app.baskets SET current_version_id = v.id FROM app.basket_versions v WHERE v.basket_id = baskets.id AND baskets.slug LIKE 'bulk-%'`;
    const first = await get("/v1/public/baskets");
    expect(first.body.items).toHaveLength(PAGE_SIZE);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await get(`/v1/public/baskets?cursor=${first.body.nextCursor}`);
    const seen = [...first.body.items, ...second.body.items].map((i: { slug: string }) => i.slug);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(listed!.count + PAGE_SIZE + 1);
    expect(second.body.nextCursor).toBeNull();
    expect((await get("/v1/public/baskets?cursor=garbage")).status).toBe(400);
  });

  it("is rate limited per IP", async () => {
    await redis.flushdb();
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await get("/v1/public/baskets/no-such-basket-abc123")).status);
    expect(codes.slice(0, 60).every((c) => c === 404)).toBe(true);
    expect(codes[60]).toBe(429);
    await redis.flushdb();
  });
});

describe("organization public profile", () => {
  it("lists the organization's baskets in listed statuses", async () => {
    const res = await get(`/v1/public/organizations/${org.id}`);
    expect(res.status).toBe(200);
    const names = res.body.baskets.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Public Basket", "Leaderless Basket"]));
    for (const hidden of ["Only A Draft", "Will Be Rejected", "Retired Basket"]) expect(names).not.toContain(hidden);
    expect(res.body.baskets.find((x: { name: string }) => x.name === "Public Basket")).toEqual({ slug: await slugOf(live.id), name: "Public Basket", status: "ACTIVE" });
  });
});
