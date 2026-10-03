import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { app } from "../../src/app";
import { lifi } from "../../src/providers/routes/lifi";
import { adminSql, resetDb } from "../helpers/db";
import { webHeaders } from "../helpers/auth";
import { seedBasket, seedUser, type SeedAsset } from "./helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 3000 };
const BTC: SeedAsset = { symbol: "BTC", chain: "bitcoin", bps: 2000 };

const investability = (slug: string, h?: Record<string, string>) => request(app).get(`/v1/baskets/${slug}/investability`).set(h ?? webHeaders());
const reasonCodes = (body: { reasons: { code: string }[] }) => body.reasons.map((r) => r.code);

let connections: MockInstance<typeof lifi.connections>;
beforeEach(async () => {
  await resetDb();
  connections = vi.spyOn(lifi, "connections").mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("basket investability", () => {
  it("an active crypto basket with routes and connections is investable and needs the chain families of its constituents", async () => {
    const b = await seedBasket({ assets: [SOL, ETH, BTC], minimum: "250" });
    const res = await investability(b.slug);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ basketId: expect.any(String), investable: true, reasons: [], requiredFamilies: ["solana", "evm", "bitcoin"], minimumUsdc: "250" });
    expect(connections).toHaveBeenCalledWith(expect.objectContaining({ fromChain: "solana", toChain: "bitcoin", toToken: null }));
  });

  it("needs a market price for a tokenized (RWA) constituent (the full RWA rules are in eligibility/enforcement.test.ts)", async () => {
    const b = await seedBasket({ assets: [SOL, { symbol: "BUIDL", chain: "ethereum", tokenStandard: "erc20", bps: 5000, assetType: "TOKENIZED_FUND" }] });
    const res = await investability(b.slug);
    expect(res.body.investable).toBe(false);
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: "RWA_PRICE_REQUIRED", instrumentId: b.deployments[1]!.instrumentId })]);
  });

  it("reports a constituent without an execution route, with a disabled provider, or without a connection", async () => {
    const b = await seedBasket({ assets: [SOL, { ...ETH, noRoute: true }, { symbol: "OTH", chain: "base", tokenStandard: "native", bps: 1000, providerName: "Jupiter" }] });
    expect(reasonCodes((await investability(b.slug)).body).sort()).toEqual(["NO_ROUTE", "NO_ROUTE"]);
    const c = await seedBasket({ assets: [SOL, ETH] });
    connections.mockImplementation(async (i) => i.toChain !== "ethereum");
    const res = await investability(c.slug);
    expect(res.body.reasons).toEqual([expect.objectContaining({ code: "NO_CONNECTION", instrumentId: c.deployments[1]!.instrumentId })]);
  });

  it("reports a provider outage as a reason, not an error", async () => {
    const b = await seedBasket({ assets: [SOL] });
    connections.mockRejectedValue(new Error("down"));
    const res = await investability(b.slug);
    expect(res.status).toBe(200);
    expect(reasonCodes(res.body)).toEqual(["ROUTE_UNAVAILABLE"]);
  });

  it("refuses Bitcoin that is not a native deployment", async () => {
    const b = await seedBasket({ assets: [SOL, { symbol: "BTC", chain: "bitcoin", tokenStandard: "erc20", bps: 5000 }] });
    expect(reasonCodes((await investability(b.slug)).body)).toEqual(["BTC_NOT_NATIVE"]);
  });

  it("is not investable unless the basket is ACTIVE, and 404s an unknown slug", async () => {
    const b = await seedBasket({ assets: [SOL], status: "PAUSED" });
    expect(reasonCodes((await investability(b.slug)).body)).toEqual(["BASKET_NOT_ACTIVE"]);
    expect((await investability("nope-123")).status).toBe(404);
  });
});

describe("eligibility", () => {
  it("is only returned with a session; a complete user is eligible", async () => {
    const b = await seedBasket({ assets: [SOL, ETH, BTC] });
    expect((await investability(b.slug)).body.eligibility).toBeUndefined();
    const u = await seedUser({ bitcoin: true });
    expect((await investability(b.slug, u.h)).body.eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it("flags an unverified phone, a missing EVM link and a missing Bitcoin link", async () => {
    const b = await seedBasket({ assets: [SOL, ETH, BTC] });
    const u = await seedUser({ phone: false, evm: false });
    const { eligibility } = (await investability(b.slug, u.h)).body;
    expect(eligibility.eligible).toBe(false);
    expect(reasonCodes(eligibility).sort()).toEqual(["BTC_ADDRESS_REQUIRED", "EVM_ADDRESS_REQUIRED", "PHONE_NOT_VERIFIED"]);
  });

  it("a Solana-only basket needs neither EVM nor Bitcoin links", async () => {
    const b = await seedBasket({ assets: [SOL] });
    const u = await seedUser({ evm: false });
    expect((await investability(b.slug, u.h)).body.eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it("flags an active operation", async () => {
    const b = await seedBasket({ assets: [SOL] });
    const u = await seedUser();
    await adminSql`INSERT INTO app.operations (id, user_id, basket_id, kind, status, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
      VALUES (gen_random_uuid(), ${u.userId}, ${b.basketId}, 'invest', 'IN_PROGRESS', 100, 10000, ${b.versionId}, 'key-12345', now() + interval '30 minutes')`;
    expect(reasonCodes((await investability(b.slug, u.h)).body.eligibility)).toEqual(["OPERATION_IN_PROGRESS"]);
  });
});
