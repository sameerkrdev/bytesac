import { beforeEach, describe, expect, it } from "vitest";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { evmAddress, get, mkAsset, post, reviewer, setStatus, solanaAddress } from "./helpers";

beforeEach(resetDb);

const create = (h: Record<string, string>, id: string, body: object) => post(h, `/v1/ops/assets/${id}/deployments`, body);
const deployments = () => adminSql<{ verification: string; observed_decimals: number | null; observed_symbol: string | null; observed_name: string | null; observed_at: Date | null; status: string }[]>`SELECT * FROM app.instrument_deployments ORDER BY created_at`;

describe("EVM", () => {
  it("stores the observed metadata of a matching token", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    fakes.evm.token = { decimals: 6, symbol: "USDC", name: "USD Coin" };
    const address = evmAddress();
    const res = await create(r.h, id, { chain: "base", tokenStandard: "erc20", address, decimals: 6 });
    expect(res.status).toBe(201);
    expect(res.body.deployments[0]).toMatchObject({ verification: "onchain", decimals: 6, observedDecimals: 6, observedSymbol: "USDC", observedName: "USD Coin", observedAt: expect.any(String) });
    expect(res.body.missing).not.toContain("deployment_verification");
    expect(fakes.evm.tokenCalls).toEqual([{ chain: "base", address: address.toLowerCase() }]);
  });

  it("stores a mismatch, which blocks submit", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    fakes.evm.token = { decimals: 6, symbol: "USDC", name: "USD Coin" };
    const res = await create(r.h, id, { chain: "ethereum", tokenStandard: "erc20", address: evmAddress(), decimals: 18 });
    expect(res.status).toBe(201);
    expect(res.body.deployments[0]).toMatchObject({ decimals: 18, observedDecimals: 6 });
    expect(res.body.missing).toContain("deployment_verification");
  });

  it("a non-token stores null observed values with the time of the check", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    fakes.evm.token = null;
    const res = await create(r.h, id, { chain: "arbitrum", tokenStandard: "erc20", address: evmAddress(), decimals: 18 });
    expect(res.status).toBe(201);
    expect(res.body.deployments[0]).toMatchObject({ verification: "onchain", observedDecimals: null, observedSymbol: null, observedName: null, observedAt: expect.any(String) });
    expect(res.body.missing).toContain("deployment_verification");
  });

  it("an RPC outage is a 503 and nothing is stored (Review Focus 3)", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    fakes.evm.tokenBehavior = "unavailable";
    const res = await create(r.h, id, { chain: "bnb", tokenStandard: "erc20", address: evmAddress(), decimals: 18 });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("VERIFIER_UNAVAILABLE");
    expect(await deployments()).toHaveLength(0);
    expect(await adminSql`SELECT 1 FROM app.asset_events WHERE entity_type = 'deployment'`).toHaveLength(0);
  });
});

describe("Solana", () => {
  it("stores the mint decimals; symbol and name are not on-chain", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const mint = solanaAddress();
    fakes.solana.decimals = 6;
    const res = await create(r.h, id, { chain: "solana", tokenStandard: "spl", address: mint, decimals: 6 });
    expect(res.status).toBe(201);
    expect(res.body.deployments[0]).toMatchObject({ address: mint, verification: "onchain", observedDecimals: 6, observedSymbol: null, observedName: null });
    expect(fakes.solana.calls).toEqual([mint]);
    expect(fakes.evm.tokenCalls).toEqual([]);
  });

  it("a mint the RPC rejects is stored as not-a-token; an outage stores nothing", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    fakes.solana.decimals = null;
    const res = await create(r.h, id, { chain: "solana", tokenStandard: "spl_token_2022", address: solanaAddress(), decimals: 6 });
    expect(res.body.deployments[0]).toMatchObject({ observedDecimals: null, observedAt: expect.any(String) });
    fakes.solana.behavior = "unavailable";
    expect((await create(r.h, id, { chain: "solana", tokenStandard: "spl", address: solanaAddress(), decimals: 6 })).status).toBe(503);
    expect(await deployments()).toHaveLength(1);
    expect((await create(r.h, id, { chain: "solana", tokenStandard: "spl", address: "not-base58!", decimals: 6 })).status).toBe(400);
  });
});

describe("manual", () => {
  it("native assets and Polygon deployments are manual and never call a provider", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const native = await create(r.h, id, { chain: "solana", tokenStandard: "native", decimals: 9 });
    const polygon = await create(r.h, id, { chain: "polygon", tokenStandard: "erc20", address: evmAddress(), decimals: 6, sourceUrl: "https://polygonscan.com/token/x" });
    expect(native.body.deployments[0]).toMatchObject({ verification: "manual", observedDecimals: null, observedAt: null });
    expect(polygon.body.deployments[1]).toMatchObject({ verification: "manual", observedAt: null, sourceUrl: "https://polygonscan.com/token/x" });
    expect(native.body.missing).toContain("deployment_source_url");
    expect(polygon.body.missing).toEqual(["deployment_source_url", "market_price_reference"]);
    expect(fakes.evm.tokenCalls).toEqual([]);
    expect(fakes.solana.calls).toEqual([]);
  });
});

describe("verify", () => {
  const draft = async (h: Record<string, string>) => {
    const id = await mkAsset(h);
    fakes.evm.token = { decimals: 18, symbol: "OLD", name: "Old" };
    const res = await create(h, id, { chain: "ethereum", tokenStandard: "erc20", address: evmAddress(), decimals: 18 });
    return { id, did: res.body.deployments[0].id as string };
  };

  it("re-reads the chain of a DRAFT deployment and records a verified event", async () => {
    const r = await reviewer();
    const { id, did } = await draft(r.h);
    fakes.evm.token = { decimals: 18, symbol: "NEW", name: "New" };
    const res = await post(r.h, `/v1/ops/assets/${id}/deployments/${did}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.deployments[0]).toMatchObject({ observedSymbol: "NEW", observedName: "New" });
    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual(["created", "created", "verified"]);
  });

  it("an outage leaves the stored values untouched", async () => {
    const r = await reviewer();
    const { id, did } = await draft(r.h);
    fakes.evm.tokenBehavior = "unavailable";
    expect((await post(r.h, `/v1/ops/assets/${id}/deployments/${did}/verify`)).status).toBe(503);
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.deployments[0]).toMatchObject({ observedSymbol: "OLD" });
  });

  it("is refused once the deployment is no longer a draft, for manual ones, and for foreign ids", async () => {
    const r = await reviewer();
    const { id, did } = await draft(r.h);
    const native = (await create(r.h, id, { chain: "ethereum", tokenStandard: "native", decimals: 18 })).body.deployments[1].id as string;
    expect((await post(r.h, `/v1/ops/assets/${id}/deployments/${native}/verify`)).status).toBe(409);
    const other = await mkAsset(r.h, { name: "Other", symbol: "OTH" });
    expect((await post(r.h, `/v1/ops/assets/${other}/deployments/${did}/verify`)).status).toBe(404);
    await setStatus("instrument_deployments", did, "APPROVED");
    const res = await post(r.h, `/v1/ops/assets/${id}/deployments/${did}/verify`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("the 31st verification in an hour is rate limited", async () => {
    const r = await reviewer();
    const { id, did } = await draft(r.h);
    for (let i = 0; i < 30; i++) expect((await post(r.h, `/v1/ops/assets/${id}/deployments/${did}/verify`)).status).toBe(200);
    const res = await post(r.h, `/v1/ops/assets/${id}/deployments/${did}/verify`);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});
