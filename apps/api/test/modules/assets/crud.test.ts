import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql, resetDb } from "../../helpers/db";
import { evmAddress, get, mkAsset, mkDeployment, mkIssuer, mkProvider, mkRoute, mkRule, patch, plainUser, post, putRef, readyCrypto, reviewer, setStatus } from "./helpers";

beforeEach(resetDb);

const LOCKED = "Retire this item and add a new one to change it.";
const count = async (table: string, where = adminSql``) => Number((await adminSql`SELECT count(*)::int AS n FROM ${adminSql(`app.${table}`)} ${where}`)[0]!.n);

describe("create and edit", () => {
  it("reviewer creates; anonymous gets 401, a user without a role 403", async () => {
    const r = await reviewer();
    const res = await post(r.h, "/v1/ops/assets", { name: "Solana", symbol: "sol", assetType: "CRYPTO" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ symbol: "SOL", status: "DRAFT", createdByUserId: r.userId, missing: ["deployment", "market_price_reference"] });
    expect((await request(app).post("/v1/ops/assets").send({})).status).toBe(401);
    const u = await plainUser();
    expect((await post(u.h, "/v1/ops/assets", { name: "Solana", symbol: "sol", assetType: "CRYPTO" })).status).toBe(403);
    expect((await get(u.h, "/v1/ops/assets")).status).toBe(403);
    expect(await count("asset_events")).toBe(1);
    expect(await count("audit_events", adminSql`WHERE action = 'asset.instrument.created'`)).toBe(1);
  });

  it("descriptive fields stay editable when ACTIVE and write an event", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    await setStatus("instruments", id, "ACTIVE");
    const res = await patch(r.h, `/v1/ops/assets/${id}`, { description: "Layer 1", riskNotes: "Volatile", links: [{ label: "Site", url: "https://solana.com" }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: "Layer 1", status: "ACTIVE" });
    expect(await count("asset_events", adminSql`WHERE kind = 'updated' AND entity_type = 'instrument'`)).toBe(1);
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { links: [{ label: "x", url: "http://insecure.example" }] })).status).toBe(400);
  });

  it("type and symbol lock from APPROVED on (Review Focus 5); unchanged values pass", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { symbol: "solx" })).status).toBe(200);
    await setStatus("instruments", id, "ACTIVE");
    for (const body of [{ symbol: "SOL" }, { assetType: "STABLECOIN" }]) {
      const res = await patch(r.h, `/v1/ops/assets/${id}`, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: LOCKED });
    }
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body).toMatchObject({ symbol: "SOLX", assetType: "CRYPTO" });
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { symbol: "SOLX", name: "Solana Renamed" })).status).toBe(200);
  });

  it("an UNDER_REVIEW or RETIRED instrument refuses every edit and addition", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    await setStatus("instruments", id, "UNDER_REVIEW");
    const attempts = () => Promise.all([
      patch(r.h, `/v1/ops/assets/${id}`, { name: "Other" }),
      post(r.h, `/v1/ops/assets/${id}/deployments`, { chain: "ethereum", tokenStandard: "native", decimals: 18 }),
      putRef(r.h, id, "market", { externalId: "1" }),
      post(r.h, `/v1/ops/assets/${id}/rules`, { jurisdiction: "*", action: "acquire", outcome: "ALLOWED" }),
    ]);
    for (const res of await attempts()) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "This asset is under review." });
    }
    await setStatus("instruments", id, "RETIRED");
    for (const res of await attempts()) expect(res.body.error.message).toBe("This asset is retired.");
    const detail = (await get(r.h, `/v1/ops/assets/${id}`)).body;
    expect(detail).toMatchObject({ name: "Solana", deployments: [], rules: [], priceReferences: [] });
  });
});

describe("deployments", () => {
  it("a token is registered once per chain, any case, any instrument; retiring frees it (Review Focus 2)", async () => {
    const r = await reviewer();
    const a = await mkAsset(r.h);
    const b = await mkAsset(r.h, { name: "Other", symbol: "OTH" });
    const address = evmAddress();
    const first = await mkDeployment(r.h, a, { address }); // checksummed input, stored lowercase
    expect((await get(r.h, `/v1/ops/assets/${a}`)).body.deployments[0].address).toBe(address.toLowerCase());
    for (const [id, addr] of [[a, address.toLowerCase()], [b, address]] as const) {
      const dup = await post(r.h, `/v1/ops/assets/${id}/deployments`, { chain: "ethereum", tokenStandard: "erc20", address: addr, decimals: 18 });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatchObject({ code: "DEPLOYMENT_EXISTS", message: "This token is already registered." });
    }
    expect((await post(r.h, `/v1/ops/assets/${b}/deployments`, { chain: "base", tokenStandard: "erc20", address, decimals: 18 })).status).toBe(201);
    await setStatus("instrument_deployments", first, "RETIRED");
    expect((await post(r.h, `/v1/ops/assets/${b}/deployments`, { chain: "ethereum", tokenStandard: "erc20", address, decimals: 18 })).status).toBe(201);
    expect(await count("instrument_deployments")).toBe(3);
  });

  it("one live native deployment per instrument and chain", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const native = { chain: "ethereum", tokenStandard: "native", decimals: 18, sourceUrl: "https://ethereum.org" };
    expect((await post(r.h, `/v1/ops/assets/${id}/deployments`, native)).status).toBe(201);
    expect((await post(r.h, `/v1/ops/assets/${id}/deployments`, native)).body.error.code).toBe("DEPLOYMENT_EXISTS");
  });

  it("bitcoin is native only; address and standard must agree", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const bad = [
      { chain: "bitcoin", tokenStandard: "other", address: "bc1qxyz", decimals: 8 },
      { chain: "bitcoin", tokenStandard: "erc20", address: evmAddress(), decimals: 8 },
      { chain: "ethereum", tokenStandard: "native", address: evmAddress(), decimals: 18 },
      { chain: "ethereum", tokenStandard: "erc20", decimals: 18 },
      { chain: "ethereum", tokenStandard: "spl", address: evmAddress(), decimals: 18 },
      { chain: "ethereum", tokenStandard: "erc20", address: "0x123", decimals: 18 },
    ];
    for (const body of bad) expect((await post(r.h, `/v1/ops/assets/${id}/deployments`, body)).status).toBe(400);
    expect((await post(r.h, `/v1/ops/assets/${id}/deployments`, { chain: "bitcoin", tokenStandard: "native", decimals: 8, sourceUrl: "https://bitcoin.org" })).status).toBe(201);
    expect(await count("instrument_deployments")).toBe(1);
  });

  it("identity fields are editable on a DRAFT deployment and locked once APPROVED; nothing changes on refusal (Review Focus 5)", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const did = await mkDeployment(r.h, id);
    expect((await patch(r.h, `/v1/ops/assets/${id}/deployments/${did}`, { decimals: 6 })).body.deployments[0].decimals).toBe(6);
    await setStatus("instrument_deployments", did, "APPROVED");
    await setStatus("instruments", id, "ACTIVE");
    const before = (await get(r.h, `/v1/ops/assets/${id}`)).body.deployments[0];
    for (const body of [{ decimals: 8 }, { address: evmAddress() }, { chain: "base" }, { tokenStandard: "other" }]) {
      const res = await patch(r.h, `/v1/ops/assets/${id}/deployments/${did}`, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: LOCKED });
    }
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.deployments[0]).toEqual(before);
    const res = await patch(r.h, `/v1/ops/assets/${id}/deployments/${did}`, { sourceUrl: "https://example.com/token" });
    expect(res.status).toBe(200);
    expect(res.body.deployments[0].sourceUrl).toBe("https://example.com/token");
  });
});

describe("fix wave", () => {
  it("a manual deployment source URL and an RWA issuer lock after approval", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "Fund", symbol: "FND", assetType: "TOKENIZED_TREASURY", issuerId: await mkIssuer(r.h) });
    const did = await mkDeployment(r.h, id, { chain: "bitcoin", tokenStandard: "native", address: undefined, decimals: 8, sourceUrl: "https://bitcoin.org" });
    await setStatus("instrument_deployments", did, "APPROVED");
    await setStatus("instruments", id, "ACTIVE");
    const path = `/v1/ops/assets/${id}/deployments/${did}`;
    for (const sourceUrl of ["https://other.example", null]) {
      const res = await patch(r.h, path, { sourceUrl });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(LOCKED);
    }
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.deployments[0].sourceUrl).toBe("https://bitcoin.org");
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { issuerId: null })).status).toBe(409);
  });

  it("a route cannot use a retired deployment, and one on a retired deployment does not satisfy the route requirement", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "Fund", symbol: "FND", assetType: "TOKENIZED_TREASURY" });
    const did = await mkDeployment(r.h, id);
    const provider = await mkProvider(r.h);
    await mkRoute(r.h, id, did, provider);
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.missing).not.toContain("route");
    await setStatus("instrument_deployments", did, "RETIRED");
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.missing).toContain("route");
    const res = await post(r.h, `/v1/ops/assets/${id}/routes`, { deploymentId: did, providerId: provider, venue: "Jupiter", method: "swap", processingModel: "sync" });
    expect(res.status).toBe(404);
  });
});

describe("routes, rules, prices", () => {
  it("a route needs a deployment of the same instrument and existing references", async () => {
    const r = await reviewer();
    const a = await mkAsset(r.h);
    const b = await mkAsset(r.h, { name: "Other", symbol: "OTH" });
    const da = await mkDeployment(r.h, a);
    const db = await mkDeployment(r.h, b);
    const provider = await mkProvider(r.h);
    const body = { deploymentId: db, providerId: provider, venue: "Jupiter", method: "swap", processingModel: "sync" };
    expect((await post(r.h, `/v1/ops/assets/${a}/routes`, body)).status).toBe(404);
    expect((await post(r.h, `/v1/ops/assets/${a}/routes`, { ...body, deploymentId: da, providerId: crypto.randomUUID() })).status).toBe(404);
    expect((await post(r.h, `/v1/ops/assets/${a}/routes`, { ...body, deploymentId: da, settlementInstrumentId: crypto.randomUUID() })).status).toBe(404);
    const rid = await mkRoute(r.h, a, da, provider, { settlementInstrumentId: b, minimumAmount: "10.5" });
    expect((await get(r.h, `/v1/ops/assets/${a}`)).body.routes[0]).toMatchObject({ id: rid, minimumAmount: "10.5", status: "DRAFT" });
    expect((await patch(r.h, `/v1/ops/assets/${a}/routes/${rid}`, { deploymentId: db })).status).toBe(404);
    expect(await count("execution_routes")).toBe(1);
  });

  it("an APPROVED route locks deployment, method, provider and settlement asset but not descriptive fields", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const did = await mkDeployment(r.h, id);
    const rid = await mkRoute(r.h, id, did, await mkProvider(r.h));
    expect((await patch(r.h, `/v1/ops/assets/${id}/routes/${rid}`, { method: "subscription" })).status).toBe(200);
    await setStatus("execution_routes", rid, "APPROVED");
    await setStatus("instruments", id, "ACTIVE");
    const res = await patch(r.h, `/v1/ops/assets/${id}/routes/${rid}`, { method: "swap" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(LOCKED);
    expect((await patch(r.h, `/v1/ops/assets/${id}/routes/${rid}`, { settlementInstrumentId: id })).status).toBe(409);
    expect((await patch(r.h, `/v1/ops/assets/${id}/routes/${rid}`, { settlementInstrumentId: null })).status).toBe(200);
    expect((await patch(r.h, `/v1/ops/assets/${id}/routes/${rid}`, { venue: "Orca", minimumAmount: "1" })).body.routes[0]).toMatchObject({ venue: "Orca", minimumAmount: "1" });
  });

  it("rules are added and retired; a retired rule stays retired", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const rule = (await mkRule(r.h, id, { jurisdiction: "US", outcome: "RESTRICTED" })).body.rules[0];
    expect(rule).toMatchObject({ status: "ACTIVE", jurisdiction: "US" });
    expect((await post(r.h, `/v1/ops/assets/${id}/rules`, { jurisdiction: "usa", action: "acquire", outcome: "ALLOWED" })).status).toBe(400);
    expect((await patch(r.h, `/v1/ops/assets/${id}/rules/${rule.id}`, { status: "RETIRED" })).body.rules[0].status).toBe("RETIRED");
    expect((await patch(r.h, `/v1/ops/assets/${id}/rules/${rule.id}`, { outcome: "ALLOWED" })).status).toBe(409);
    expect(await count("asset_events", adminSql`WHERE entity_type = 'rule' AND kind = 'retired'`)).toBe(1);
  });

  it("putting a price reference twice leaves one ACTIVE and one RETIRED; a market price needs a CMC id", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    expect((await putRef(r.h, id, "market")).status).toBe(400);
    expect((await putRef(r.h, id, "market", { externalId: "5426" })).status).toBe(200);
    const res = await putRef(r.h, id, "market", { externalId: "1027" });
    expect(res.body.priceReferences.map((p: { status: string; externalId: string }) => [p.externalId, p.status])).toEqual([["5426", "RETIRED"], ["1027", "ACTIVE"]]);
    expect(res.body.priceReferences[1]).toMatchObject({ kind: "market", provider: "coinmarketcap" });
    expect((await putRef(r.h, id, "nav")).body.priceReferences.at(-1)).toMatchObject({ kind: "nav", provider: "issuer", externalId: null, status: "ACTIVE" });
    expect((await request(app).put(`/v1/ops/assets/${id}/price-references/bogus`).set(r.h).send({})).status).toBe(400);
  });

  it("NAV needs an active nav reference", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { assetType: "TOKENIZED_TREASURY" });
    const nav = { value: "101.25", asOf: "2026-09-29", sourceUrl: "https://issuer.example/nav" };
    expect((await post(r.h, `/v1/ops/assets/${id}/nav`, nav)).status).toBe(409);
    expect(await count("nav_observations")).toBe(0);
    await putRef(r.h, id, "nav");
    const res = await post(r.h, `/v1/ops/assets/${id}/nav`, nav);
    expect(res.status).toBe(201);
    expect(res.body.navObservations).toHaveLength(1);
    expect(res.body.navObservations[0]).toMatchObject({ value: "101.25", asOf: "2026-09-29", enteredByUserId: r.userId });
    expect((await post(r.h, `/v1/ops/assets/${id}/nav`, { ...nav, value: "1e5" })).status).toBe(400);
  });
});

describe("missing requirements", () => {
  it("CRYPTO: no price reference, unverified deployment, manual without source", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const missing = async () => (await get(r.h, `/v1/ops/assets/${id}`)).body.missing;
    expect(await missing()).toEqual(["deployment", "market_price_reference"]);
    const verified = await mkDeployment(r.h, id);
    expect(await missing()).toEqual(["market_price_reference"]);
    await putRef(r.h, id, "market", { externalId: "1" });
    expect(await missing()).toEqual([]);
    await adminSql`UPDATE app.instrument_deployments SET observed_decimals = 6 WHERE id = ${verified}`;
    expect(await missing()).toEqual(["deployment_verification"]);
    await adminSql`UPDATE app.instrument_deployments SET observed_decimals = NULL WHERE id = ${verified}`;
    expect(await missing()).toEqual(["deployment_verification"]);
    await adminSql`UPDATE app.instrument_deployments SET observed_decimals = 18 WHERE id = ${verified}`;
    await post(r.h, `/v1/ops/assets/${id}/deployments`, { chain: "polygon", tokenStandard: "erc20", address: evmAddress(), decimals: 18 });
    expect(await missing()).toEqual(["deployment_source_url"]);
    await setStatus("instrument_deployments", verified, "RETIRED");
    expect(await missing()).toEqual(["deployment_source_url"]);
  });

  it("RWA: issuer, route and eligibility rule; no market price needed", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "T-Bill Fund", symbol: "TBF", assetType: "TOKENIZED_TREASURY" });
    const did = await mkDeployment(r.h, id);
    const missing = async () => (await get(r.h, `/v1/ops/assets/${id}`)).body.missing;
    expect(await missing()).toEqual(["issuer", "route", "eligibility_rule"]);
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { issuerId: await mkIssuer(r.h) })).status).toBe(200);
    expect(await missing()).toEqual(["route", "eligibility_rule"]);
    const rid = await mkRoute(r.h, id, did, await mkProvider(r.h));
    expect(await missing()).toEqual(["eligibility_rule"]);
    await mkRule(r.h, id);
    expect(await missing()).toEqual([]);
    await setStatus("execution_routes", rid, "RETIRED");
    expect(await missing()).toEqual(["route"]);
    expect((await patch(r.h, `/v1/ops/assets/${id}`, { issuerId: crypto.randomUUID() })).status).toBe(404);
  });
});

describe("list", () => {
  it("filters by status, type, chain and text, and pages by cursor", async () => {
    const r = await reviewer();
    const { id: sol } = await readyCrypto(r.h, { name: "Solana", symbol: "sol" });
    const usdc = await mkAsset(r.h, { name: "USD Coin", symbol: "usdc", assetType: "STABLECOIN" });
    await mkDeployment(r.h, usdc, { chain: "base" });
    const retired = await mkDeployment(r.h, usdc, { chain: "polygon", sourceUrl: "https://example.com" });
    await setStatus("instrument_deployments", retired, "RETIRED");
    await setStatus("instruments", usdc, "ACTIVE");
    const ids = async (qs: string) => ((await get(r.h, `/v1/ops/assets?${qs}`)).body.items as Array<{ id: string }>).map((i) => i.id);
    expect(await ids("")).toEqual([usdc, sol]);
    expect(await ids("status=ACTIVE")).toEqual([usdc]);
    expect(await ids("type=CRYPTO")).toEqual([sol]);
    expect(await ids("chain=base")).toEqual([usdc]);
    expect(await ids("chain=polygon")).toEqual([]);
    expect(await ids("q=usd")).toEqual([usdc]);
    expect(await ids("q=%25")).toEqual([]);
    expect((await get(r.h, "/v1/ops/assets?status=NOPE")).status).toBe(400);
    expect((await get(r.h, "/v1/ops/assets")).body.items[0]).toEqual({ id: usdc, name: "USD Coin", symbol: "USDC", assetType: "STABLECOIN", status: "ACTIVE", chains: ["base"], updatedAt: expect.any(String) });

    await adminSql`INSERT INTO app.instruments (id, name, symbol, asset_type, created_by_user_id) SELECT gen_random_uuid(), 'Bulk ' || g, 'B' || g, 'CRYPTO', ${r.userId} FROM generate_series(1, 26) g`;
    const page1 = (await get(r.h, "/v1/ops/assets")).body;
    expect(page1.items).toHaveLength(25);
    const page2 = (await get(r.h, `/v1/ops/assets?cursor=${page1.nextCursor}`)).body;
    expect(page2.items).toHaveLength(3);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((i: { id: string }) => i.id)).size).toBe(28);
    expect((await get(r.h, "/v1/ops/assets?cursor=garbage")).status).toBe(400);
  });
});

describe("issuers and providers", () => {
  it("are created, renamed and listed; names are unique; audited", async () => {
    const r = await reviewer();
    const issuer = await mkIssuer(r.h, "BlackRock");
    expect((await post(r.h, "/v1/ops/asset-issuers", { name: "BlackRock" })).status).toBe(400);
    expect((await patch(r.h, `/v1/ops/asset-issuers/${issuer}`, { jurisdiction: "US", website: "https://blackrock.com" })).body).toMatchObject({ name: "BlackRock", jurisdiction: "US" });
    expect((await get(r.h, "/v1/ops/asset-issuers")).body).toHaveLength(1);
    expect((await patch(r.h, `/v1/ops/asset-issuers/${crypto.randomUUID()}`, { notes: "x" })).status).toBe(404);
    const provider = await mkProvider(r.h, "Jupiter");
    expect((await patch(r.h, `/v1/ops/asset-providers/${provider}`, { kind: "venue" })).body.kind).toBe("venue");
    expect((await get(r.h, "/v1/ops/asset-providers")).body).toHaveLength(1);
    expect(await count("audit_events", adminSql`WHERE action LIKE 'asset.issuer.%' OR action LIKE 'asset.provider.%'`)).toBe(4);
  });
});

describe("grants", () => {
  it("the runtime role cannot DELETE from any asset table", async () => {
    const tables = ["asset_issuers", "asset_providers", "instruments", "instrument_deployments", "execution_routes", "eligibility_rules", "price_references", "nav_observations", "asset_events"];
    for (const t of tables) {
      const [row] = await adminSql<{ del: boolean; ins: boolean }[]>`SELECT has_table_privilege('bytesac_api', ${`app.${t}`}, 'DELETE') AS del, has_table_privilege('bytesac_api', ${`app.${t}`}, 'INSERT') AS ins`;
      expect(row, t).toEqual({ del: false, ins: true });
    }
  });
});
