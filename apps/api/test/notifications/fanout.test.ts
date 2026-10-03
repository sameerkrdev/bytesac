import { beforeEach, describe, expect, it } from "vitest";
import { notificationText } from "@repo/validator";
import { fanOutToHolders } from "@/services/notifications";
import { trackLeg } from "@/services/positions";
import { onVersionPublished } from "@/services/rebalance";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { seedBasket, seedPosition, seedUser, seedVersion } from "../execution/helpers";

const SOL = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 } as const;
const TKN = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 } as const;

/** A basket with holders: `open` open positions and `closed` closed ones, each its own user. */
async function holders(open: number, closed = 0) {
  const chain = mockChains();
  const basket = await seedBasket({ assets: [SOL, TKN] });
  const hold = [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 1_000_000_000n }];
  const users = [];
  for (let i = 0; i < open + closed; i++) {
    const user = await seedUser({ wallet: solanaTestWallet() });
    users.push({ user, positionId: await seedPosition(user.userId, basket, hold, i < open ? "OPEN" : "CLOSED") });
  }
  return { chain, basket, users };
}
const inbox = () => adminSql<{ user_id: string; kind: string; dedupe_key: string; basket_id: string }[]>`SELECT user_id, kind, dedupe_key, basket_id FROM app.notifications ORDER BY created_at, id`;
const deliverJobs = () => fakes.queue.jobs.filter((j) => j.name === "notifications" && j.data.job === "deliver");

/** A rebalance operation of the user in `status`, with one PLANNED leg and a gas reservation of 10,000 lamports (also counted in today's sponsor usage). */
async function openPlan(userId: string, positionId: string, basket: { basketId: string; versionId: string }, status: "PLANNED" | "IN_PROGRESS") {
  const [op] = await adminSql<{ id: string }[]>`INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at, gas_reserved)
    VALUES (gen_random_uuid(), ${userId}, ${basket.basketId}, ${positionId}, 'rebalance', ${status}, 100, 10000, ${basket.versionId}, ${"k-" + Math.random()}, now() + interval '30 minutes', ${adminSql.json({ solana: "10000" })}) RETURNING id`;
  await adminSql`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in) VALUES (gen_random_uuid(), ${op!.id}, 1, 'swap', 'solana', 'solana', 1000000)`;
  await adminSql`INSERT INTO app.sponsor_usage (user_id, chain, day, amount_native) VALUES (${userId}, 'solana', (now() at time zone 'utc')::date, '10000') ON CONFLICT (user_id, chain, day) DO UPDATE SET amount_native = '10000'`;
  return op!.id;
}

beforeEach(resetDb);

describe("a new version", () => {
  it("cancels a PLANNED rebalance (gas released, audited) but not an IN_PROGRESS one, and every open holder is told once (Review Focus 3)", async () => {
    const { basket, users } = await holders(3, 1);
    const planned = await openPlan(users[0]!.user.userId, users[0]!.positionId, basket, "PLANNED");
    const running = await openPlan(users[1]!.user.userId, users[1]!.positionId, basket, "IN_PROGRESS");
    const v3 = await seedVersion(basket, 3, [3000, 7000]);
    await onVersionPublished(basket.basketId, v3);
    expect((await adminSql`SELECT status, gas_reserved FROM app.operations WHERE id = ${planned}`)[0]).toEqual({ status: "CANCELLED", gas_reserved: {} });
    expect((await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${users[0]!.user.userId}`)[0]).toEqual({ amount_native: "0" });
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'operation.superseded' AND entity_id = ${planned}`).toHaveLength(1);
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${running}`)[0]).toEqual({ status: "IN_PROGRESS" });

    const notices = await inbox();
    expect(notices.map((n) => n.user_id).sort()).toEqual(users.slice(0, 3).map((u) => u.user.userId).sort()); // the closed position is not told
    expect(notices.every((n) => n.kind === "rebalance_available" && n.basket_id === basket.basketId)).toBe(true);
    expect(notices.map((n) => n.dedupe_key).sort()).toEqual(users.slice(0, 3).map((u) => `rebalance:${v3}:${u.positionId}`).sort());
    expect(deliverJobs()).toHaveLength(3);
    await onVersionPublished(basket.basketId, v3); // a repeated job tells nobody again
    expect(await inbox()).toHaveLength(3);
    expect(deliverJobs()).toHaveLength(3);
  });

  it("a PLANNED rebalance that already targets the new version is not superseded", async () => {
    const { basket, users } = await holders(2);
    const old = await openPlan(users[0]!.user.userId, users[0]!.positionId, basket, "PLANNED");
    const v3 = await seedVersion(basket, 3, [3000, 7000]);
    const current = await openPlan(users[1]!.user.userId, users[1]!.positionId, { basketId: basket.basketId, versionId: v3 }, "PLANNED");
    await onVersionPublished(basket.basketId, v3);
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${old}`)[0]).toEqual({ status: "CANCELLED" });
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${current}`)[0]).toEqual({ status: "PLANNED" });
  });

  it("a plan whose first leg is already claimed is left running", async () => {
    const { basket, users } = await holders(1);
    const planned = await openPlan(users[0]!.user.userId, users[0]!.positionId, basket, "PLANNED");
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTING' WHERE operation_id = ${planned}`;
    await onVersionPublished(basket.basketId, await seedVersion(basket, 3, [3000, 7000]));
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${planned}`)[0]).toEqual({ status: "PLANNED" });
  });
});

describe("basket notices", () => {
  it("tell holders of open positions only, once per event", async () => {
    const { basket, users } = await holders(2, 1);
    const kinds = ["basket_paused", "basket_unpaused", "basket_retirement_pending", "basket_retired", "lead_changed"] as const;
    for (const kind of kinds) await fanOutToHolders(basket.basketId, kind, {}, `${kind}:evt-1`);
    const notices = await inbox();
    expect(notices).toHaveLength(kinds.length * 2);
    for (const kind of kinds) expect(notices.filter((n) => n.kind === kind).map((n) => n.user_id).sort()).toEqual(users.slice(0, 2).map((u) => u.user.userId).sort());
    await fanOutToHolders(basket.basketId, "basket_paused", {}, "basket_paused:evt-1");
    expect(await inbox()).toHaveLength(kinds.length * 2);
    await fanOutToHolders(basket.basketId, "basket_paused", {}, "basket_paused:evt-2");
    expect(await inbox()).toHaveLength(kinds.length * 2 + 2);
  });
});

describe("an unfinished rebalance", () => {
  it("PARTIAL tells the user once (execution_incomplete)", async () => {
    const { chain, basket, users } = await holders(1);
    const { user, positionId } = users[0]!;
    const op = await openPlan(user.userId, positionId, basket, "IN_PROGRESS");
    const [sold] = await adminSql<{ id: string }[]>`SELECT id FROM app.operation_legs WHERE operation_id = ${op}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED', from_deployment_id = ${basket.deployments[0]!.deploymentId} WHERE id = ${sold!.id}`;
    const [buy] = await adminSql<{ id: string }[]>`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, to_deployment_id, amount_in, provider, status, source_tx, submitted_at)
      VALUES (gen_random_uuid(), ${op}, 2, 'swap', 'solana', 'solana', ${basket.deployments[1]!.deploymentId}, 1000000, 'lifi', 'SUBMITTED', 'sig-bad', now()) RETURNING id`;
    chain.solanaFinality.set("sig-bad", "failed");
    await trackLeg(buy!.id);
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${op}`)[0]).toEqual({ status: "PARTIAL" });
    expect((await inbox()).map((n) => [n.user_id, n.kind, n.dedupe_key])).toEqual([[user.userId, "execution_incomplete", `incomplete:${op}`]]);
    expect(deliverJobs()).toHaveLength(1);
  });

  it("a FAILED repair tells the user once, linking to the repair page", async () => {
    const { chain, basket, users } = await holders(1);
    const { user, positionId } = users[0]!;
    const deploymentId = basket.deployments[0]!.deploymentId;
    const [op] = await adminSql<{ id: string }[]>`INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, deployment_id, repair_shares, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
      VALUES (gen_random_uuid(), ${user.userId}, NULL, NULL, 'repair', 'IN_PROGRESS', ${deploymentId}, ${adminSql.json({ [positionId]: "5" })}, 100, 10000, ${basket.versionId}, 'k-repair-12345', now() + interval '30 minutes') RETURNING id`;
    const [buy] = await adminSql<{ id: string }[]>`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, to_deployment_id, amount_in, provider, status, source_tx, submitted_at)
      VALUES (gen_random_uuid(), ${op!.id}, 1, 'swap', 'solana', 'solana', ${deploymentId}, 1000000, 'lifi', 'SUBMITTED', 'sig-bad', now()) RETURNING id`;
    chain.solanaFinality.set("sig-bad", "failed");
    await trackLeg(buy!.id);
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${op!.id}`)[0]).toEqual({ status: "FAILED" });
    const [n] = await adminSql<{ user_id: string; kind: string; dedupe_key: string; basket_id: string | null; data: { asset: string } }[]>`SELECT user_id, kind, dedupe_key, basket_id, data FROM app.notifications`;
    expect(n).toMatchObject({ user_id: user.userId, kind: "execution_incomplete", dedupe_key: `incomplete:${op!.id}`, basket_id: null, data: { asset: deploymentId } });
    expect(notificationText("execution_incomplete", { asset: deploymentId }).link).toBe(`/portfolio/repair/${deploymentId}`);
    expect(deliverJobs()).toHaveLength(1);
  });
});
