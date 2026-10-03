import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { act, activeCrypto, admin, decide, evmAddress, get, itemAct, mkAsset, mkDeployment, mkIssuer, mkProvider, mkRoute, mkRule, patch, plainUser, post, putRef, readyCrypto, reviewer, setStatus, submit } from "./helpers";

beforeEach(resetDb);

const ids = async (h: Record<string, string>, qs = "") => ((await get(h, `/v1/assets${qs}`)).body.items as Array<{ id: string }>).map((i) => i.id);

/** Every key path of a JSON value; arrays are collapsed to `[]`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap((v) => keyPaths(v, `${prefix}[]`)))];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [`${prefix}.${k}`, ...keyPaths(v, `${prefix}.${k}`)]);
  return [];
}

describe("visibility", () => {
  it("lists only ACTIVE instruments that have an ACTIVE deployment", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    const live = await activeCrypto(r, a);
    const draft = await readyCrypto(r.h, { name: "Draft", symbol: "DRF" });
    const approved = await readyCrypto(r.h, { name: "Approved", symbol: "APR" });
    await submit(r.h, approved.id);
    await decide(a.h, approved.id, { decision: "approved" });
    const noDeployment = await mkAsset(r.h, { name: "Bare", symbol: "BRE" });
    await setStatus("instruments", noDeployment, "ACTIVE");
    const paused = await activeCrypto(r, a, { name: "Paused", symbol: "PSD" });
    await act(a.h, paused.id, "pause");
    const deprecated = await activeCrypto(r, a, { name: "Deprecated", symbol: "DEP" });
    await act(a.h, deprecated.id, "deprecate");
    const itemsPaused = await activeCrypto(r, a, { name: "Items paused", symbol: "ITM" });
    await itemAct(a.h, itemsPaused.id, "deployments", itemsPaused.deploymentId, "pause");

    expect(await ids(u.h)).toEqual([live.id]);
    expect(await ids(u.h, "?type=STABLECOIN")).toEqual([]);
    expect(await ids(u.h, "?chain=ethereum")).toEqual([live.id]);
    expect(await ids(u.h, "?chain=base")).toEqual([]);
    expect(await ids(u.h, "?q=sol")).toEqual([live.id]);
    for (const { id } of [draft, approved, paused, deprecated]) expect((await get(u.h, `/v1/assets/${id}`)).status).toBe(404);
    // ACTIVE instruments without an ACTIVE deployment are not listed but stay readable (with no deployments).
    for (const id of [noDeployment, itemsPaused.id]) expect((await get(u.h, `/v1/assets/${id}`)).body).toMatchObject({ deployments: [], routes: [] });
    expect((await get(u.h, `/v1/assets`)).body.items[0]).toEqual({ id: live.id, name: "Solana", symbol: "SOL", assetType: "CRYPTO", chains: ["ethereum"] });
  });

  it("a paused deployment disappears from the detail while another keeps the instrument listed; a paused instrument disappears entirely (Review Focus 4)", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    const { id, deploymentId } = await activeCrypto(r, a);
    const second = await mkDeployment(r.h, id, { chain: "base", address: evmAddress() });
    await itemAct(a.h, id, "deployments", second, "approve");
    await itemAct(a.h, id, "deployments", second, "activate");
    expect((await get(u.h, `/v1/assets/${id}`)).body.deployments.map((d: { chain: string }) => d.chain)).toEqual(["ethereum", "base"]);
    await itemAct(a.h, id, "deployments", deploymentId, "pause");
    expect((await get(u.h, `/v1/assets/${id}`)).body.deployments.map((d: { chain: string }) => d.chain)).toEqual(["base"]);
    expect(await ids(u.h)).toEqual([id]);
    expect(await ids(u.h, "?chain=ethereum")).toEqual([]);
    await act(a.h, id, "pause");
    expect(await ids(u.h)).toEqual([]);
    const res = await get(u.h, `/v1/assets/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    await act(a.h, id, "resume");
    expect(await ids(u.h)).toEqual([id]);
    await act(a.h, id, "deprecate");
    expect(await ids(u.h)).toEqual([]);
    expect((await get(u.h, `/v1/assets/${id}`)).status).toBe(404);
  });

  it("routes show only while they and their deployment are ACTIVE; a settlement symbol only while that asset is ACTIVE", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    const usdc = await activeCrypto(r, a, { name: "USD Coin", symbol: "usdc" });
    const sol = await activeCrypto(r, a);
    const provider = await mkProvider(r.h, "Jupiter");
    const route = await mkRoute(r.h, sol.id, sol.deploymentId, provider, { settlementInstrumentId: usdc.id, minimumAmount: "25.5" });
    const routes = async () => (await get(u.h, `/v1/assets/${sol.id}`)).body.routes;
    expect(await routes()).toEqual([]);
    await itemAct(a.h, sol.id, "routes", route, "approve");
    expect(await routes()).toEqual([]);
    await itemAct(a.h, sol.id, "routes", route, "activate");
    expect(await routes()).toEqual([{ chain: "ethereum", method: "swap", providerName: "Jupiter", settlementSymbol: "USDC", minimumAmount: "25.5", processingModel: "sync" }]);
    await act(a.h, usdc.id, "pause");
    expect((await routes())[0].settlementSymbol).toBeNull();
    await itemAct(a.h, sol.id, "deployments", sol.deploymentId, "pause");
    expect(await routes()).toEqual([]);
  });
});

describe("allow-list", () => {
  it("returns exactly the public keys and no internals", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    const issuer = await mkIssuer(r.h, "Circle");
    const { id, deploymentId } = await readyCrypto(r.h, { name: "USD Coin", symbol: "usdc", assetType: "STABLECOIN", issuerId: issuer, description: "A dollar", riskNotes: "Issuer risk", links: [{ label: "Site", url: "https://circle.com" }] });
    await patch(r.h, `/v1/ops/assets/${id}`, { issuerId: issuer });
    await mkRule(r.h, id, { jurisdiction: "US", sourceText: "SECRET-RULE-TEXT" });
    await mkRoute(r.h, id, deploymentId, await mkProvider(r.h));
    await putRef(r.h, id, "nav");
    fakes.cmc.quotes.set("1027", { value: "1.0001", observedAt: new Date().toISOString() });
    await redis.del("price:cmc:1027"); // building the fixtures priced it once, unavailable (cached for 60 s)
    await submit(r.h, id);
    await decide(a.h, id, { decision: "approved", message: "SECRET-MESSAGE", internalNote: "SECRET-NOTE" });
    await act(a.h, id, "activate");
    const routeId = (await get(a.h, `/v1/ops/assets/${id}`)).body.routes[0].id;
    await itemAct(a.h, id, "routes", routeId, "approve");
    await itemAct(a.h, id, "routes", routeId, "activate");

    const res = await get(u.h, `/v1/assets/${id}`);
    expect(res.status).toBe(200);
    expect(keyPaths(res.body).sort()).toEqual([
      ".assetType", ".deployments", ".deployments[].address", ".deployments[].chain", ".deployments[].decimals", ".deployments[].tokenStandard", ".description", ".id",
      ".issuer", ".issuer.name", ".issuer.website", ".links", ".links[].label", ".links[].url", ".name", ".prices", ".prices[].currency", ".prices[].instrumentId", ".prices[].kind",
      ".prices[].observedAt", ".prices[].source", ".prices[].stale", ".prices[].status", ".prices[].value", ".riskNotes", ".routes", ".routes[].chain", ".routes[].method",
      ".routes[].minimumAmount", ".routes[].processingModel", ".routes[].providerName", ".routes[].settlementSymbol", ".symbol",
    ].sort());
    expect(res.body.prices.map((p: { kind: string; status: string }) => [p.kind, p.status])).toEqual([["market", "ok"], ["nav", "unavailable"]]);
    const text = JSON.stringify(res.body);
    for (const secret of ["SECRET-RULE-TEXT", "SECRET-MESSAGE", "SECRET-NOTE", "TKN", r.userId, a.userId, "observedDecimals", "observedSymbol", "observedName"]) expect(text).not.toContain(secret);
    expect(res.body).toMatchObject({ issuer: { name: "Circle", website: null }, links: [{ label: "Site", url: "https://circle.com" }], description: "A dollar" });
  });

  it("the list is summary-only", async () => {
    const r = await reviewer();
    const a = await admin();
    const u = await plainUser();
    await activeCrypto(r, a);
    const item = (await get(u.h, "/v1/assets")).body.items[0];
    expect(Object.keys(item).sort()).toEqual(["assetType", "chains", "id", "name", "symbol"]);
    expect(Object.keys((await get(u.h, "/v1/assets")).body).sort()).toEqual(["items", "nextCursor"]);
  });
});

describe("access", () => {
  it("needs a session, validates the id, and 404s unknown assets", async () => {
    const u = await plainUser();
    expect((await request(app).get("/v1/assets")).status).toBe(401);
    expect((await request(app).get(`/v1/assets/${crypto.randomUUID()}`)).status).toBe(401);
    expect((await get(u.h, "/v1/assets/not-a-uuid")).status).toBe(400);
    expect((await get(u.h, `/v1/assets/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get(u.h, "/v1/assets?type=NOPE")).status).toBe(400);
    expect((await get(u.h, "/v1/assets?status=DRAFT")).status).toBe(200);
  });

  it("a user with no platform role can read but not reach ops", async () => {
    const u = await plainUser();
    expect((await get(u.h, "/v1/assets")).status).toBe(200);
    expect((await get(u.h, "/v1/ops/assets")).status).toBe(403);
    expect((await post(u.h, "/v1/ops/assets", { name: "x", symbol: "x", assetType: "CRYPTO" })).status).toBe(403);
  });

  it("the status query parameter cannot widen the public list", async () => {
    const r = await reviewer();
    const u = await plainUser();
    await readyCrypto(r.h);
    await adminSql`UPDATE app.instruments SET status = 'DRAFT'`;
    expect(await ids(u.h, "?status=DRAFT")).toEqual([]);
  });
});
