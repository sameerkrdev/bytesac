import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { seedPlatformWallets } from "../../src/services/gas";
import { reconcilePositions } from "../../src/services/positions";
import { webHeaders } from "../helpers/auth";
import { adminSql, resetDb } from "../helpers/db";
import { balanceKey, mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "../execution/helpers";

// The geo header name is switchable per test (the parsed env is read-only).
const geo = vi.hoisted(() => ({ header: "" }));
vi.mock("../../src/env", async (original) => {
  const m = await original<typeof import("../../src/env")>();
  return { ...m, env: new Proxy({} as typeof m.env, { get: (_, k) => (k === "GEO_COUNTRY_HEADER" ? geo.header : Reflect.get(m.env, k)) }) };
});

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 6000, decimals: 9 };
const BOND: SeedAsset = { symbol: "BOND", chain: "solana", tokenStandard: "spl", decimals: 6, bps: 4000, assetType: "TOKENIZED_TREASURY" };
const FUND: SeedAsset = { symbol: "FUND", chain: "solana", tokenStandard: "spl", decimals: 6, bps: 4000, assetType: "TOKENIZED_FUND" };
type H = Record<string, string>;

const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const invest = (h: H, basketId: string, over: object = {}, header?: [string, string]) => {
  const r = post(h, "/v1/operations/invest", { basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-aaaaaaaa", ...over });
  return header ? r.set(...header) : r;
};
const sell = (h: H, positionId: string, over: object = {}) => post(h, "/v1/operations/sell", { positionId, percent: 100, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa", ...over });
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const investability = (slug: string, h: H) => request(app).get(`/v1/baskets/${slug}/investability`).set(h);
const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code);

const addRule = async (instrumentId: string, outcome: string, over: { jurisdiction?: string; action?: string } = {}) =>
  (await adminSql<{ id: string }[]>`INSERT INTO app.eligibility_rules (id, instrument_id, jurisdiction, action, outcome, status)
    VALUES (gen_random_uuid(), ${instrumentId}, ${over.jurisdiction ?? "DE"}, ${over.action ?? "acquire"}, ${outcome}, 'ACTIVE') RETURNING id`)[0]!.id;
const declare = (userId: string, o: { country?: string; status?: string; ageDays?: number } = {}) =>
  adminSql`INSERT INTO app.eligibility_declarations (id, user_id, country, investor_status, attestation_version, created_at)
    VALUES (gen_random_uuid(), ${userId}, ${o.country ?? "DE"}, ${o.status ?? "retail"}, '2026-10-03', now() - make_interval(days => ${o.ageDays ?? 0}::int))`;
const decisions = () => adminSql<{ instrument_id: string; leg_id: string | null; action: string; outcome: string; rule_ids: string[]; ip_country: string | null }[]>`SELECT * FROM app.eligibility_decisions ORDER BY evaluated_at, id`;
const legStatus = async (id: string) => (await adminSql<{ status: string }[]>`SELECT status FROM app.operation_legs WHERE id = ${id}`)[0]!.status;

/** An ACTIVE basket of `assets` with prices ($1 for tokenized assets) and a user with 1,000 USDC on Solana. */
async function arrange(assets: SeedAsset[] = [SOL, BOND]) {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets });
  const user = await seedUser({ wallet: solanaTestWallet() });
  await seedPrices(basket.deployments, basket.deployments.map((_, n) => (assets[n]!.assetType ? "1" : "100")));
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
  const rwa = (symbol: string) => basket.deployments.find((d) => d.symbol === symbol)!;
  return { chain, basket, user, rwa };
}

beforeEach(async () => {
  geo.header = "";
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

describe("RWA investability", () => {
  it("reports permissioned, route-unsupported and price-less tokenized assets", async () => {
    const { basket, rwa } = await arrange([
      SOL, { ...BOND, permissioned: true }, { ...FUND, symbol: "SUB", method: "subscription" }, { ...FUND, symbol: "NOPRICE" },
    ]);
    // arrange priced every tokenized asset: drop the price of NOPRICE
    await adminSql`DELETE FROM app.price_references WHERE instrument_id = ${rwa("NOPRICE").instrumentId}`;
    const res = await investability(basket.slug, webHeaders());
    expect(res.body.investable).toBe(false);
    expect(Object.fromEntries(res.body.reasons.map((r: { instrumentId: string; code: string }) => [r.instrumentId, r.code]))).toEqual({
      [rwa("BOND").instrumentId]: "RWA_PERMISSIONED", [rwa("SUB").instrumentId]: "RWA_ROUTE_UNSUPPORTED", [rwa("NOPRICE").instrumentId]: "RWA_PRICE_REQUIRED",
    });
  });

  it("a permissionless RWA with a swap route and a price is investable; per user it needs a declaration and an ALLOWED rule", async () => {
    const { basket, user, rwa } = await arrange();
    expect((await investability(basket.slug, webHeaders())).body).toMatchObject({ investable: true, reasons: [] });
    const withoutDeclaration = (await investability(basket.slug, user.h)).body.eligibility;
    expect(withoutDeclaration.eligible).toBe(false);
    expect(codes(withoutDeclaration.reasons)).toEqual(["DECLARATION_REQUIRED"]);

    await declare(user.userId);
    const noRule = (await investability(basket.slug, user.h)).body.eligibility;
    expect(noRule.reasons).toEqual([expect.objectContaining({ code: "NOT_ELIGIBLE_ASSET", instrumentId: rwa("BOND").instrumentId, outcome: "RESTRICTED", reason: "NO_RULE" })]);

    await addRule(rwa("BOND").instrumentId, "ALLOWED");
    expect((await investability(basket.slug, user.h)).body.eligibility).toEqual({ eligible: true, reasons: [] });
    await adminSql`UPDATE app.eligibility_rules SET outcome = 'RESTRICTED'`;
    expect(codes((await investability(basket.slug, user.h)).body.eligibility.reasons)).toEqual(["NOT_ELIGIBLE_ASSET"]);
  });
});

describe("invest", () => {
  it("a crypto-only basket invests without a declaration, as before (Review Focus 4)", async () => {
    const { basket, user } = await arrange([SOL, { ...SOL, symbol: "SOL2", bps: 4000 }]);
    expect((await invest(user.h, basket.basketId)).status).toBe(201);
    expect(await decisions()).toEqual([]);
  });

  it("an RWA basket without a declaration is 409 DECLARATION_REQUIRED; with an allowing declaration the plan stores a decision per RWA leg", async () => {
    const { basket, user, rwa } = await arrange();
    await addRule(rwa("BOND").instrumentId, "ALLOWED");
    const refused = await invest(user.h, basket.basketId);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("DECLARATION_REQUIRED");
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(0);

    await declare(user.userId);
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    const bondLeg = res.body.legs.find((l: { toDeploymentId: string }) => l.toDeploymentId === rwa("BOND").deploymentId);
    expect(await decisions()).toEqual([expect.objectContaining({ instrument_id: rwa("BOND").instrumentId, leg_id: bondLeg.id, action: "acquire", outcome: "ALLOWED", ip_country: null })]);
  });

  it("an expired declaration (366 days) is DECLARATION_REQUIRED; a new declaration unblocks (Review Focus 5)", async () => {
    const { basket, user, rwa } = await arrange();
    await addRule(rwa("BOND").instrumentId, "ALLOWED");
    await declare(user.userId, { ageDays: 366 });
    expect((await invest(user.h, basket.basketId)).body.error.code).toBe("DECLARATION_REQUIRED");
    await declare(user.userId);
    expect((await invest(user.h, basket.basketId)).status).toBe(201);
  });

  it("a restricted RWA is 409 NOT_ELIGIBLE with the reasons and nothing is planned", async () => {
    const { basket, user, rwa } = await arrange();
    await declare(user.userId);
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect(res.body.error.details.reasons).toEqual([expect.objectContaining({ code: "NOT_ELIGIBLE_ASSET", instrumentId: rwa("BOND").instrumentId, outcome: "RESTRICTED" })]);
    expect(await adminSql`SELECT 1 FROM app.operations`).toHaveLength(0);
  });
});

describe("geo signal (Review Focus 3)", () => {
  it("is ignored while GEO_COUNTRY_HEADER is unset; set, a country that differs from the declared one needs review", async () => {
    const { basket, user, rwa } = await arrange();
    await addRule(rwa("BOND").instrumentId, "ALLOWED");
    await declare(user.userId, { country: "DE" });
    expect((await invest(user.h, basket.basketId, {}, ["CF-IPCountry", "FR"])).status).toBe(201); // a spoofed header changes nothing

    await resetDb();
    geo.header = "CF-IPCountry";
    const again = await arrange();
    await addRule(again.rwa("BOND").instrumentId, "ALLOWED");
    await declare(again.user.userId, { country: "DE" });
    const mismatch = await invest(again.user.h, again.basket.basketId, {}, ["CF-IPCountry", "FR"]);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.details.reasons).toEqual([expect.objectContaining({ outcome: "REVIEW_REQUIRED", reason: "IP_COUNTRY_MISMATCH" })]);
    expect((await invest(again.user.h, again.basket.basketId, {}, ["CF-IPCountry", "de"])).status).toBe(201);
    expect((await decisions())[0]).toMatchObject({ ip_country: "DE" });
  });
});

describe("rule change between plan and signature (Review Focus 1)", () => {
  async function planned() {
    const a = await arrange();
    const ruleId = await addRule(a.rwa("BOND").instrumentId, "ALLOWED");
    await declare(a.user.userId);
    const op = (await invest(a.user.h, a.basket.basketId)).body;
    const [fee, sol, bond] = op.legs;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id IN (${fee.id}, ${sol.id})`;
    return { ...a, op, fee, sol, bond, ruleId };
  }

  it("quoting the RWA leg is 409 NOT_ELIGIBLE, the decision is recorded and the settled legs stand", async () => {
    const { user, op, sol, bond, ruleId } = await planned();
    await adminSql`UPDATE app.eligibility_rules SET outcome = 'RESTRICTED' WHERE id = ${ruleId}`;
    const res = await quote(user.h, op.id, bond.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect(await decisions()).toEqual([
      expect.objectContaining({ leg_id: bond.id, outcome: "ALLOWED" }), // the plan
      expect.objectContaining({ leg_id: bond.id, outcome: "RESTRICTED", rule_ids: [ruleId] }), // the refused quote
    ]);
    expect(await legStatus(sol.id)).toBe("SETTLED");
    expect(await legStatus(bond.id)).toBe("PLANNED");
  });

  it("an allowed RWA leg quotes and records a decision", async () => {
    const { user, op, bond } = await planned();
    expect((await quote(user.h, op.id, bond.id)).status).toBe(200);
    expect(await decisions()).toHaveLength(2);
  });

  it("a recovery leg to an RWA target is re-checked at its quote", async () => {
    const { user, op, bond, ruleId, rwa } = await planned();
    await adminSql`UPDATE app.operation_legs SET status = 'FAILED', failure_reason = 'DESTINATION_SWAP_FAILED' WHERE id = ${bond.id}`;
    const [recovery] = await adminSql<{ id: string }[]>`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, to_deployment_id, amount_in, provider, gas_payer, recovery_of, route_summary)
      VALUES (gen_random_uuid(), ${op.id}, 4, 'swap', 'solana', 'solana', ${rwa("BOND").deploymentId}, 1000000, 'lifi', 'platform_fee_payer', ${bond.id}, ${adminSql.json({ fromToken: null })}) RETURNING id`;
    await adminSql`UPDATE app.eligibility_rules SET outcome = 'RESTRICTED' WHERE id = ${ruleId}`;
    const res = await quote(user.h, op.id, recovery!.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect((await decisions()).at(-1)).toMatchObject({ leg_id: recovery!.id, outcome: "RESTRICTED" });
  });
});

describe("rebalance and repair", () => {
  it("a rebalance of a basket with a restricted RWA is refused 409 NOT_ELIGIBLE", async () => {
    const { chain, basket, user, rwa } = await arrange();
    await declare(user.userId);
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 10_000_000_000n }, { deploymentId: rwa("BOND").deploymentId, quantity: 1_000_000_000n }]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, rwa("BOND").address), 1_000_000_000n);
    await seedVersion(basket, 2, [3000, 7000]);
    const res = await post(user.h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect(res.body.error.details.reasons).toEqual([expect.objectContaining({ instrumentId: rwa("BOND").instrumentId, outcome: "RESTRICTED" })]);
  });

  /** SOL ($1,000) and BOND ($1,000, no acquire rule) held; the new version moves the weights by `v2` (SOL, TKN, BOND). */
  async function arrangeThree(v2: number[], bondRule?: { outcome: string; action: string }) {
    const a = await arrange([{ ...SOL, bps: 4000 }, { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 2000, decimals: 6 }, { ...BOND, bps: 4000 }]);
    await declare(a.user.userId);
    if (bondRule) await addRule(a.rwa("BOND").instrumentId, bondRule.outcome, { action: bondRule.action });
    const [sol, , bond] = a.basket.deployments;
    const positionId = await seedPosition(a.user.userId, a.basket, [{ deploymentId: sol!.deploymentId, quantity: 10_000_000_000n }, { deploymentId: bond!.deploymentId, quantity: 1_000_000_000n }]);
    a.chain.balances.set(balanceKey(a.user.solanaAddress, null), 10_000_000_000n);
    a.chain.balances.set(balanceKey(a.user.solanaAddress, bond!.address), 1_000_000_000n);
    await seedVersion(a.basket, 2, v2);
    return { ...a, positionId };
  }
  const rebalance = (h: H, positionId: string) => post(h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa" });

  it("an RWA that is only held does not refuse a crypto-only rebalance, even when it can't be acquired", async () => {
    const { user, positionId } = await arrangeThree([2500, 2500, 5000]); // sell SOL, buy TKN, BOND stays
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(201);
    expect(await decisions()).toEqual([]);
  });

  it("a plan that sells an RWA the user may not sell is 409 NOT_ELIGIBLE; allowed, the sell leg stores a decision", async () => {
    const refused = await arrangeThree([4000, 4000, 2000], { outcome: "RESTRICTED", action: "sell" }); // BOND is sold down
    const res = await rebalance(refused.user.h, refused.positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect(res.body.error.details.reasons).toEqual([expect.objectContaining({ instrumentId: refused.rwa("BOND").instrumentId, outcome: "RESTRICTED" })]);
    expect(await adminSql`SELECT 1 FROM app.operations WHERE kind = 'rebalance'`).toHaveLength(0);

    await resetDb();
    const ok = await arrangeThree([4000, 4000, 2000], { outcome: "ALLOWED", action: "sell" });
    const planned = await rebalance(ok.user.h, ok.positionId);
    expect(planned.status).toBe(201);
    const bondSell = planned.body.legs.find((l: { fromDeploymentId: string }) => l.fromDeploymentId === ok.rwa("BOND").deploymentId);
    expect(await decisions()).toEqual([expect.objectContaining({ instrument_id: ok.rwa("BOND").instrumentId, leg_id: bondSell.id, action: "sell", outcome: "ALLOWED" })]);
  });

  it("a repair buy-back of a restricted RWA is refused, and syncing the shortfall still works", async () => {
    const { chain, basket, user, rwa } = await arrange([BOND]);
    await declare(user.userId);
    const bond = rwa("BOND");
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: bond.deploymentId, quantity: 10n }]);
    chain.balances.set(balanceKey(user.solanaAddress, bond.address), 4n);
    await reconcilePositions(user.userId);
    const repair = await post(user.h, "/v1/operations/repair", { deploymentId: bond.deploymentId, slippageBps: 100, idempotencyKey: "rep-aaaaaaaa" });
    expect(repair.status).toBe(409);
    expect(repair.body.error.code).toBe("NOT_ELIGIBLE");
    const sync = await post(user.h, "/v1/portfolio/sync", { asset: { deploymentId: bond.deploymentId }, split: [{ positionId, quantity: "6" }], idempotencyKey: "sync-aaaaaaaa" });
    expect(sync.status).toBe(200);
  });
});

describe("sell", () => {
  async function arrangeSell(rules: { BOND?: string; FUND?: string }) {
    const a = await arrange([BOND, FUND]);
    await declare(a.user.userId);
    for (const [symbol, outcome] of Object.entries(rules)) await addRule(a.rwa(symbol).instrumentId, outcome, { action: "sell" });
    const positionId = await seedPosition(a.user.userId, a.basket, [{ deploymentId: a.rwa("BOND").deploymentId, quantity: 5_000_000n }, { deploymentId: a.rwa("FUND").deploymentId, quantity: 7_000_000n }]);
    for (const symbol of ["BOND", "FUND"]) a.chain.balances.set(balanceKey(a.user.solanaAddress, a.rwa(symbol).address), 10_000_000n);
    return { ...a, positionId };
  }

  it("leaves a restricted RWA out with a notice and a decision without a leg, and sells the allowed one", async () => {
    const { user, positionId, rwa } = await arrangeSell({ BOND: "RESTRICTED", FUND: "ALLOWED" });
    const res = await sell(user.h, positionId);
    expect(res.status).toBe(201);
    expect(res.body.legs.filter((l: { kind: string }) => l.kind !== "network_fee").map((l: { fromDeploymentId: string }) => l.fromDeploymentId)).toEqual([rwa("FUND").deploymentId]);
    expect(res.body.excluded).toEqual([{ instrumentId: rwa("BOND").instrumentId, symbol: "BOND", notice: "You can't sell BOND through Bytesac in your region; it stays in your wallet." }]);
    const rows = await decisions();
    expect(rows.find((r) => r.instrument_id === rwa("BOND").instrumentId)).toMatchObject({ leg_id: null, action: "sell", outcome: "RESTRICTED" });
    expect(rows.find((r) => r.instrument_id === rwa("FUND").instrumentId)).toMatchObject({ outcome: "ALLOWED" });
    expect(rows.find((r) => r.instrument_id === rwa("FUND").instrumentId)!.leg_id).not.toBeNull();
    const replay = await sell(user.h, positionId); // the same key: the exclusions come back from the stored decisions
    expect(replay.status).toBe(201);
    expect(replay.body.excluded).toEqual(res.body.excluded);
  });

  it("when every RWA is restricted nothing is planned: 409 NOT_ELIGIBLE", async () => {
    const { user, positionId } = await arrangeSell({ BOND: "RESTRICTED", FUND: "KYC_REQUIRED" });
    const res = await sell(user.h, positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ELIGIBLE");
    expect(await adminSql`SELECT 1 FROM app.operations WHERE kind = 'sell_to_usdc'`).toHaveLength(0);
  });

  it("without a declaration the RWA is left out with a notice and the crypto still sells", async () => {
    const { chain, basket, user, rwa } = await arrange();
    await addRule(rwa("BOND").instrumentId, "ALLOWED", { action: "sell" });
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 1_000_000_000n }, { deploymentId: rwa("BOND").deploymentId, quantity: 5_000_000n }]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, rwa("BOND").address), 10_000_000n);
    const res = await sell(user.h, positionId);
    expect(res.status).toBe(201);
    expect(res.body.legs.filter((l: { kind: string }) => l.kind !== "network_fee").map((l: { fromDeploymentId: string }) => l.fromDeploymentId)).toEqual([basket.deployments[0]!.deploymentId]);
    expect(res.body.excluded).toEqual([{ instrumentId: rwa("BOND").instrumentId, symbol: "BOND", notice: "Confirm your eligibility to sell BOND through Bytesac." }]);
    expect(await decisions()).toEqual([]);
  });

  it("without a declaration a sell of an RWA asks for one", async () => {
    const { user, positionId } = await arrangeSell({ BOND: "ALLOWED", FUND: "ALLOWED" });
    await adminSql`DELETE FROM app.eligibility_declarations`;
    expect((await sell(user.h, positionId)).body.error.code).toBe("DECLARATION_REQUIRED");
  });
});
