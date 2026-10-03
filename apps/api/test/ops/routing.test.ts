import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { seedPlatformWallets } from "@/services/gas";
import { forgetRoutePolicy, routeDenyList } from "@/services/routing";
import { balanceKey, mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { USDC_MINT, seedBasket, seedLeg, seedUser, type SeedAsset } from "../execution/helpers";
import { adminSql, resetDb } from "../helpers/db";
import { opsUser } from "../modules/manager-applications/helpers";

const tools = { bridges: [{ key: "across", name: "Across" }, { key: "mayan", name: "Mayan" }, { key: "stargate", name: "Stargate" }], exchanges: [{ key: "uniswap", name: "Uniswap" }] };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** LI.FI answers by path; an unlisted path is a 404. `seen` records every request URL. */
function lifiStub(bodies: Record<string, unknown>) {
  const seen: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    seen.push(u);
    return u.pathname in bodies ? jsonResponse(bodies[u.pathname]) : jsonResponse({ message: "not found" }, 404);
  }));
  return seen;
}
const audit = (action: string) => adminSql<{ actor_user_id: string; entity_id: string; metadata: Record<string, unknown> }[]>`SELECT actor_user_id, entity_id, metadata FROM app.audit_events WHERE action = ${action}`;

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  forgetRoutePolicy();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route policy", () => {
  it("ops roles read the LI.FI tools with their deny state; only ops_admin denies; deny is audited, validated against /tools, and not repeatable", async () => {
    lifiStub({ "/v1/tools": tools });
    const admin = await opsUser(app, "ops_admin");
    const reviewer = await opsUser(app, "ops_reviewer");
    const first = await request(app).get("/v1/ops/routing").set(reviewer.h);
    expect(first.status).toBe(200);
    expect(first.body.bridges).toEqual([{ key: "across", name: "Across", denyEntryId: null }, { key: "mayan", name: "Mayan", denyEntryId: null }, { key: "stargate", name: "Stargate", denyEntryId: null }]);
    expect(first.body.entries).toEqual([]);

    const body = { kind: "bridge", toolKey: "stargate", reason: "Delays reported on Stargate" };
    expect((await request(app).post("/v1/ops/routing/deny").set(reviewer.h).send(body)).status).toBe(403);
    const denied = await request(app).post("/v1/ops/routing/deny").set(admin.h).send(body);
    expect(denied.status).toBe(201);
    expect(denied.body).toMatchObject({ kind: "bridge", toolKey: "stargate", reason: body.reason, createdBy: admin.userId, removedAt: null });
    expect(await audit("route_policy.denied")).toEqual([{ actor_user_id: admin.userId, entity_id: denied.body.id, metadata: { kind: "bridge", toolKey: "stargate", reason: body.reason } }]);

    const again = await request(app).post("/v1/ops/routing/deny").set(admin.h).send(body);
    expect(again.status).toBe(400); // the error handler maps VALIDATION_FAILED to 400
    expect(again.body.error.code).toBe("VALIDATION_FAILED");
    const unknown = await request(app).post("/v1/ops/routing/deny").set(admin.h).send({ ...body, toolKey: "nonexistent" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("VALIDATION_FAILED");
    expect((await request(app).post("/v1/ops/routing/deny").set(admin.h).send({ ...body, kind: "exchange" })).status).toBe(400); // "stargate" is a bridge, not an exchange
    expect((await request(app).post("/v1/ops/routing/deny").set(admin.h).send({ ...body, reason: "" })).status).toBe(400);

    const after = await request(app).get("/v1/ops/routing").set(reviewer.h);
    expect(after.body.bridges.find((b: { key: string }) => b.key === "stargate").denyEntryId).toBe(denied.body.id);
    expect(after.body.entries).toHaveLength(1);
  });

  it("allow records removedAt/removedBy and an audit row, keeps the history, is not repeatable, and the next quote no longer carries it", async () => {
    lifiStub({ "/v1/tools": tools });
    const admin = await opsUser(app, "ops_admin");
    const reviewer = await opsUser(app, "ops_reviewer");
    const denied = await request(app).post("/v1/ops/routing/deny").set(admin.h).send({ kind: "exchange", toolKey: "uniswap", reason: "Bad fills" });
    expect(await routeDenyList("solana", "SomeSolanaAddress")).toEqual({ bridges: [], exchanges: ["uniswap"] });

    expect((await request(app).post(`/v1/ops/routing/${denied.body.id}/allow`).set(reviewer.h)).status).toBe(403);
    const allowed = await request(app).post(`/v1/ops/routing/${denied.body.id}/allow`).set(admin.h);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ id: denied.body.id, removedBy: admin.userId, removedAt: expect.any(String) });
    expect(await audit("route_policy.allowed")).toEqual([{ actor_user_id: admin.userId, entity_id: denied.body.id, metadata: { kind: "exchange", toolKey: "uniswap" } }]);
    expect(await routeDenyList("solana", "SomeSolanaAddress")).toEqual({ bridges: [], exchanges: [] });
    const twice = await request(app).post(`/v1/ops/routing/${denied.body.id}/allow`).set(admin.h);
    expect(twice.status).toBe(409);
    expect((await request(app).post("/v1/ops/routing/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f/allow").set(admin.h)).status).toBe(404);
    expect((await request(app).get("/v1/ops/routing").set(reviewer.h)).body.entries).toHaveLength(1);
    // the same tool can be denied again once allowed
    expect((await request(app).post("/v1/ops/routing/deny").set(admin.h).send({ kind: "exchange", toolKey: "uniswap", reason: "Again" })).status).toBe(201);
  });

  it("another process’s change is picked up when the 60 s cache expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await routeDenyList("solana", "SomeSolanaAddress")).bridges).toEqual([]);
    const admin = await opsUser(app, "ops_admin");
    await adminSql`INSERT INTO app.route_policy_entries (id, kind, tool_key, reason, created_by) VALUES (gen_random_uuid(), 'bridge', 'stargate', 'direct', ${admin.userId})`;
    expect((await routeDenyList("solana", "SomeSolanaAddress")).bridges).toEqual([]);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await routeDenyList("solana", "SomeSolanaAddress")).bridges).toEqual(["stargate"]);
  });
});

describe("LI.FI transfer lookup", () => {
  const WINDOW = 24 * 3600;
  async function submittedLeg() {
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10000 }] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    const { operationId, legId } = await seedLeg(user.userId, basket, { fromChain: "ethereum", toChain: "solana", kind: "cross_chain" });
    await adminSql`UPDATE app.operation_legs SET submitted_at = '2026-10-01T12:00:00Z' WHERE id = ${legId}`;
    return { user, operationId, legId, at: Date.parse("2026-10-01T12:00:00Z") / 1000 };
  }

  it("is ops_admin only, asks LI.FI for the leg's source address with status=ALL within 24 h of the submission, and drops records outside it", async () => {
    const { user, operationId, legId, at } = await submittedLeg();
    const seen = lifiStub({ "/v2/analytics/transfers": { data: [{ id: "in", sending: { timestamp: at + 60 } }, { id: "edge", sending: { timestamp: at - WINDOW } }, { id: "out", sending: { timestamp: at + WINDOW + 1 } }, { id: "no-time" }], hasNext: false } });
    const admin = await opsUser(app, "ops_admin");
    const reviewer = await opsUser(app, "ops_reviewer");
    const path = `/v1/ops/operations/${operationId}/legs/${legId}/lifi-transfers`;
    expect((await request(app).get(path).set(reviewer.h)).status).toBe(403);
    expect(seen).toHaveLength(0);
    const res = await request(app).get(path).set(admin.h);
    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe(user.evmAddress);
    expect(res.body.transfers.map((t: { id: string }) => t.id)).toEqual(["in", "edge", "no-time"]);
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({ wallet: user.evmAddress, status: "ALL", fromTimestamp: String(at - WINDOW), toTimestamp: String(at + WINDOW) });
  });

  it("a leg that was never submitted, or an operation that does not own the leg, is refused; a LI.FI outage is a 503", async () => {
    const { operationId, legId } = await submittedLeg();
    const admin = await opsUser(app, "ops_admin");
    lifiStub({});
    const down = await request(app).get(`/v1/ops/operations/${operationId}/legs/${legId}/lifi-transfers`).set(admin.h);
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect((await request(app).get(`/v1/ops/operations/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f/legs/${legId}/lifi-transfers`).set(admin.h)).status).toBe(404);
    await adminSql`UPDATE app.operation_legs SET submitted_at = NULL WHERE id = ${legId}`;
    expect((await request(app).get(`/v1/ops/operations/${operationId}/legs/${legId}/lifi-transfers`).set(admin.h)).status).toBe(409);
  });
});

describe("asset review: LI.FI verification and the fee-on-transfer flag", () => {
  const ERC20: SeedAsset = { symbol: "AAA", chain: "ethereum", tokenStandard: "erc20", bps: 4000, decimals: 18 };
  const OTHER: SeedAsset = { symbol: "BBB", chain: "ethereum", tokenStandard: "erc20", bps: 3000, decimals: 18 };
  const NATIVE: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 3000, decimals: 9 };

  it("lifiVerification: listed in LI.FI's token list is verified, unlisted is unverified, a native asset is null; an outage is null, never an error", async () => {
    const basket = await seedBasket({ assets: [ERC20, OTHER, NATIVE] });
    const [listed, unlisted, native] = basket.deployments;
    const admin = await opsUser(app, "ops_admin");
    const seen = lifiStub({ "/v1/tokens": { tokens: { 1: [{ address: listed!.address!.toUpperCase().replace("0X", "0x") }, { address: "0x" + "99".repeat(20) }] } } });
    const detail = async (instrumentId: string) => (await request(app).get(`/v1/ops/assets/${instrumentId}`).set(admin.h)).body.deployments[0];
    expect(await detail(listed!.instrumentId)).toMatchObject({ lifiVerification: "verified", feeOnTransfer: false });
    expect((await detail(unlisted!.instrumentId)).lifiVerification).toBe("unverified");
    expect((await detail(native!.instrumentId)).lifiVerification).toBeNull();
    expect(seen.filter((u) => u.pathname === "/v1/tokens")).toHaveLength(1); // cached 24 h per chain
    expect(seen[0]!.searchParams.get("chains")).toBe("1");

    await redis.flushdb();
    lifiStub({});
    const res = await request(app).get(`/v1/ops/assets/${listed!.instrumentId}`).set(admin.h);
    expect(res.status).toBe(200);
    expect(res.body.deployments[0].lifiVerification).toBeNull();
  });

  it("only ops_admin sets the flag (audited as an asset event); operation previews show feeOnTransfer on the legs touching that deployment", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [NATIVE, { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 7000, decimals: 6 }] });
    const [, tkn] = basket.deployments;
    const admin = await opsUser(app, "ops_admin");
    const reviewer = await opsUser(app, "ops_reviewer");
    const url = `/v1/ops/assets/${tkn!.instrumentId}/deployments/${tkn!.deploymentId}/fee-on-transfer`;
    expect((await request(app).patch(url).set(reviewer.h).send({ feeOnTransfer: true })).status).toBe(403);
    expect((await request(app).patch(url).set(admin.h).send({ feeOnTransfer: "yes" })).status).toBe(400);
    const res = await request(app).patch(url).set(admin.h).send({ feeOnTransfer: true });
    expect(res.status).toBe(200);
    expect(res.body.deployments[0].feeOnTransfer).toBe(true);
    expect(await audit("asset.deployment.updated")).toEqual([expect.objectContaining({ actor_user_id: admin.userId, entity_id: tkn!.deploymentId, metadata: { instrumentId: tkn!.instrumentId, feeOnTransfer: true } })]);
    await request(app).patch(url).set(admin.h).send({ feeOnTransfer: true }); // no change: no second event
    expect(await audit("asset.deployment.updated")).toHaveLength(1);

    const investor = await seedUser({ wallet: solanaTestWallet() });
    chain.balances.set(balanceKey(investor.solanaAddress, USDC_MINT), 1_000_000_000n);
    const plan = await request(app).post("/v1/operations/invest").set(investor.h).send({ basketId: basket.basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa" });
    expect(plan.status).toBe(201);
    expect(plan.body.legs.map((l: { toDeploymentId: string | null; feeOnTransfer: boolean }) => [l.toDeploymentId === tkn!.deploymentId, l.feeOnTransfer])).toEqual([[false, false], [true, true], [false, false]]);

    expect((await request(app).patch(url).set(admin.h).send({ feeOnTransfer: false })).body.deployments[0].feeOnTransfer).toBe(false);
  });
});
