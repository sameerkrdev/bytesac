import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { notificationText } from "@repo/validator";
import { connection } from "@/providers/solana-tx";
import { stopStalledInvests, trackLeg } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { balanceKey } from "../../helpers/chain-mocks";
import { USDC_MINT } from "../../helpers/execution";
import { addRecovery, arrange, groupReq, groupRows, legs, opRow, post, quoted, signAll, submit } from "../../helpers/groups";

type Outcome = "ok" | "fail" | "leave";
const cont = (h: Record<string, string>, opId: string, over: object = {}) => post(h, `/v1/operations/${opId}/continue`, { idempotencyKey: "cont-aaaaaaaa", ...over });
const notices = () => adminSql<{ kind: string; data: Record<string, unknown> }[]>`SELECT kind, data FROM app.notifications`;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

/** A batch signed and sent; the fee confirms on chain, then each buy ends as `outcomes` says (settled, reverted, or still in flight). */
async function sent(outcomes: Outcome[] = ["ok", "ok", "ok", "ok"]) {
  const ctx = await quoted();
  vi.spyOn(connection, "getParsedTransaction").mockResolvedValue({ blockTime: 1_800_000_000 } as never);
  await submit(ctx.user.h, ctx.op.id, ctx.group.groupId, signAll(ctx.group.transactions, ctx.wallet));
  const rows = await legs(ctx.op.id);
  const fee = rows.find((l) => l.kind === "network_fee")!;
  const buys = rows.filter((l) => l.kind !== "network_fee");
  ctx.chain.solanaFinality.set(fee.source_tx!, "finalized");
  await trackLeg(fee.id);
  for (const [n, buy] of buys.entries()) {
    if (outcomes[n] === "leave") continue;
    ctx.chain.solanaFinality.set(buy.source_tx!, outcomes[n] === "ok" ? "finalized" : "failed");
    ctx.chain.solanaReceived.set(`${buy.source_tx}:${ctx.user.solanaAddress}`, 1_000n);
    await trackLeg(buy.id);
  }
  return { ...ctx, fee, buys };
}

describe("grouped status", () => {
  it("a failed buy leaves the investment open and needing action, with no notice yet", async () => {
    const { op, user } = await sent(["ok", "fail", "ok", "ok"]);
    expect(await opRow(op.id)).toMatchObject({ status: "IN_PROGRESS" });
    expect((await opRow(op.id)).needs_action_since).not.toBeNull();
    expect(await notices()).toHaveLength(0);
    const view = (await request(app).get(`/v1/operations/${op.id}`).set(user.h)).body;
    expect(view).toMatchObject({ status: "IN_PROGRESS", needsAction: true });
    expect(view.needsActionSince).toBeTruthy();
  });

  it("completes when every buy settled and clears the clock", async () => {
    const { op } = await sent();
    expect(await opRow(op.id)).toMatchObject({ status: "COMPLETED", needs_action_since: null });
  });

  it("an operation without groups still ends PARTIAL on a failure (the per-leg path is unchanged)", async () => {
    const { op, chain } = await arrange();
    const rows = await legs(op.id);
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE operation_id = ${op.id} AND id <> ${rows[2]!.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-bad', submitted_at = now() WHERE id = ${rows[2]!.id}`;
    chain.solanaFinality.set("sig-bad", "failed");
    await trackLeg(rows[2]!.id);
    expect((await opRow(op.id)).status).toBe("PARTIAL");
  });
});

describe("continue", () => {
  it("makes a retry leg for the failed buy: same deployment, amount, fee share and coverage; the next group charges it no fee", async () => {
    const { user, op, buys, fee } = await sent(["ok", "fail", "ok", "ok"]);
    const res = await cont(user.h, op.id);
    expect(res.status).toBe(200);
    const rows = await legs(op.id);
    const original = rows.find((l) => l.id === buys[1]!.id)!; // read after the fee settled: it covers this leg
    const retry = rows.find((l) => l.retry_of === original.id)!;
    expect(original.fee_covered_by).toBe(fee.id);
    expect(retry).toMatchObject({ status: "PLANNED", amount_in: original.amount_in, fee_covered_by: fee.id, fee_share: original.fee_share });
    expect(retry.to_deployment_id).toBe(buys[1]!.to_deployment_id);
    expect(rows.find((l) => l.id === buys[1]!.id)!.status).toBe("FAILED");
    const group = await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" });
    expect(group.status).toBe(200);
    expect(group.body.transactions.map((t: { kind: string }) => t.kind)).toEqual(["asset"]);
  });

  it("is refused while a transaction is in flight or its outcome unknown", async () => {
    const { user, op, buys } = await sent(["leave", "fail", "ok", "ok"]);
    expect((await cont(user.h, op.id)).body.error.code).toBe("OPERATION_IN_PROGRESS");
    await adminSql`UPDATE app.operation_legs SET status = 'UNKNOWN' WHERE id = ${buys[0]!.id}`;
    expect((await cont(user.h, op.id)).body.error.code).toBe("OPERATION_IN_PROGRESS");
  });

  it("skips a leg: it is FAILED as SKIPPED, no retry is made, and with the rest settled the investment ends PARTIAL", async () => {
    const { user, op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    const res = await cont(user.h, op.id, { skipLegIds: [buys[1]!.id] });
    expect(res.status).toBe(200);
    const rows = await legs(op.id);
    expect(rows.find((l) => l.id === buys[1]!.id)).toMatchObject({ status: "FAILED" });
    expect(rows.find((l) => l.id === buys[1]!.id)!.failure_reason).toBe("SKIPPED");
    expect(rows).toHaveLength(5);
    expect(res.body.status).toBe("PARTIAL");
    expect((await opRow(op.id)).needs_action_since).toBeNull();
  });

  it("refuses to skip a settled leg or one that is not this investment's", async () => {
    const { user, op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    expect((await cont(user.h, op.id, { skipLegIds: [buys[0]!.id] })).status).toBe(400);
    expect((await cont(user.h, op.id, { skipLegIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    expect(await legs(op.id)).toHaveLength(5);
  });

  it("raises the slippage for the next quotes, within 1 to 300 bps", async () => {
    const { user, op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    expect((await cont(user.h, op.id, { slippageBps: 301 })).status).toBe(400);
    expect((await cont(user.h, op.id, { slippageBps: 250 })).status).toBe(200);
    expect((await adminSql<{ slippage_bps: number }[]>`SELECT slippage_bps FROM app.operations WHERE id = ${op.id}`)[0]!.slippage_bps).toBe(250);
    const group = await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" });
    expect(group.body.legs[0].minOut).toBe(((BigInt(buys[1]!.amount_in) * 9750n) / 10_000n).toString());
  });

  it("a Continue that names no slippage keeps the operation's own; a raised one stays raised for the next Continue (review I3)", async () => {
    const { user, op } = await sent(["ok", "fail", "ok", "ok"]);
    const slippage = async () => (await adminSql<{ slippage_bps: number }[]>`SELECT slippage_bps FROM app.operations WHERE id = ${op.id}`)[0]!.slippage_bps;
    await adminSql`UPDATE app.operations SET slippage_bps = 50 WHERE id = ${op.id}`;
    expect((await cont(user.h, op.id)).status).toBe(200);
    expect(await slippage()).toBe(50);
    expect((await cont(user.h, op.id, { idempotencyKey: "cont-bbbbbbbb", slippageBps: 250 })).status).toBe(200);
    expect((await cont(user.h, op.id, { idempotencyKey: "cont-cccccccc" })).status).toBe(200);
    expect(await slippage()).toBe(250);
    const audit = await adminSql<{ metadata: { slippageBps: number | null } }[]>`SELECT metadata FROM app.audit_events WHERE action = 'operation.continued' ORDER BY created_at, id`;
    expect(audit.map((a) => a.metadata.slippageBps)).toEqual([null, 250, null]); // the audit never records a slippage nobody chose
  });

  it("USDC short: 409 with the figures and nothing changed; Invest what's available scales the rest to what the wallet holds", async () => {
    const { user, op, chain, buys } = await sent(["ok", "fail", "ok", "ok"]);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 100_000_000n);
    const short = await cont(user.h, op.id);
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("INSUFFICIENT_BALANCE");
    expect(short.body.error.details).toEqual({ usdcRequiredMicro: buys[1]!.amount_in, usdcHeldMicro: "100000000" });
    expect(await legs(op.id)).toHaveLength(5); // rolled back: no retry leg
    const scaled = await cont(user.h, op.id, { idempotencyKey: "cont-bbbbbbbb", scaleToAvailable: true });
    expect(scaled.status).toBe(200);
    expect((await legs(op.id)).find((l) => l.status === "PLANNED")!.amount_in).toBe("100000000");
  });

  it("scales several unsent legs and their uncovered fee shares so that they add up to the wallet balance", async () => {
    const { user, op, chain } = await quoted();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 250_000_000n);
    expect((await cont(user.h, op.id, { scaleToAvailable: true })).status).toBe(200);
    const buys = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(buys.reduce((t, l) => t + BigInt(l.amount_in) + BigInt(l.fee_share!.manager_entry!), 0n)).toBe(250_000_000n);
    expect(buys.every((l) => l.status === "PLANNED" && l.group_id === null)).toBe(true);
    expect((await groupRows(op.id))[0]!.status).toBe("RELEASED"); // the stale unsigned batch
  });

  it("a leg scaled to nothing is skipped; with nothing left the investment stops", async () => {
    const { user, op, chain } = await sent(["ok", "fail", "ok", "ok"]);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 0n);
    const res = await cont(user.h, op.id, { scaleToAvailable: true });
    expect(res.body.status).toBe("PARTIAL");
    expect((await legs(op.id)).filter((l) => l.status === "FAILED")).toHaveLength(2);
  });

  it("SOL short: 409 SOL_REQUIRED", async () => {
    const { user, op, chain } = await sent(["ok", "fail", "ok", "ok"]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 1_000n);
    const res = await cont(user.h, op.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SOL_REQUIRED");
    expect(await legs(op.id)).toHaveLength(5);
  });

  it("is idempotent per key: one retry leg, the same answer", async () => {
    const { user, op } = await sent(["ok", "fail", "ok", "ok"]);
    const first = await cont(user.h, op.id);
    const again = await cont(user.h, op.id);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await legs(op.id)).toHaveLength(6);
  });

  it("a replay of a Continue that ended the investment answers the same view, not a 409 (review M5)", async () => {
    const { user, op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    const first = await cont(user.h, op.id, { skipLegIds: [buys[1]!.id] });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("PARTIAL");
    const again = await cont(user.h, op.id, { skipLegIds: [buys[1]!.id] });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it("a plain operation, or one that is not running, has nothing to continue", async () => {
    const { user, op } = await arrange();
    expect((await cont(user.h, op.id)).body.error.code).toBe("INVALID_TRANSITION");
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    expect((await cont(user.h, op.id)).body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("stop and the 24-hour auto-stop", () => {
  it("Stop on a needs-action investment is PARTIAL once a buy settled, FAILED when none did, and releases an unsigned batch", async () => {
    const a = await sent(["ok", "fail", "ok", "ok"]);
    await cont(a.user.h, a.op.id);
    expect((await groupReq(a.user.h, a.op.id, { idempotencyKey: "grp-bbbbbbbb" })).status).toBe(200);
    expect((await post(a.user.h, `/v1/operations/${a.op.id}/cancel`)).body.status).toBe("PARTIAL");
    expect((await groupRows(a.op.id)).at(-1)!.status).toBe("RELEASED");
    expect((await opRow(a.op.id)).needs_action_since).toBeNull();

    await resetDb();
    const b = await sent(["fail", "fail", "fail", "fail"]);
    expect((await post(b.user.h, `/v1/operations/${b.op.id}/cancel`)).body.status).toBe("FAILED");
  });

  it("stops an investment that has needed action for 24 hours: audit, one notice, a status like Stop's", async () => {
    const { op } = await sent(["ok", "fail", "ok", "ok"]);
    await adminSql`UPDATE app.operations SET needs_action_since = now() - interval '23 hours' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '23 hours' WHERE operation_id = ${op.id}`; // the last group counts as progress too
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("IN_PROGRESS");
    await adminSql`UPDATE app.operations SET needs_action_since = now() - interval '25 hours' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '25 hours' WHERE operation_id = ${op.id}`;
    await stopStalledInvests();
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("PARTIAL");
    const audit = await adminSql<{ metadata: { reason: string } }[]>`SELECT metadata FROM app.audit_events WHERE action = 'operation.auto_stopped' AND entity_id = ${op.id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata.reason).toBe("needs_action_timeout");
    const [notice, ...rest] = await notices();
    expect(rest).toHaveLength(0);
    expect(notice).toMatchObject({ kind: "execution_incomplete", data: { autoStopped: true, operationId: op.id } });
    expect(notificationText("execution_incomplete", notice!.data).body).toBe("We stopped your unfinished investment; your USDC is still in your wallet.");
    expect(fakes.queue.jobs.filter((j) => j.name === "notifications")).toHaveLength(1);
  });

  it("a quoted batch that was never signed stops the clock only for 24 hours: then the investment is auto-stopped (review I2)", async () => {
    const { user, op } = await sent(["ok", "fail", "ok", "ok"]);
    await cont(user.h, op.id);
    expect((await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" })).status).toBe(200); // quoting clears the mark; the wallet popup is then rejected and the tab closed
    expect((await opRow(op.id)).needs_action_since).toBeNull();
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '23 hours' WHERE operation_id = ${op.id}`;
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("IN_PROGRESS");
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '25 hours' WHERE operation_id = ${op.id}`;
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("PARTIAL");
    expect((await groupRows(op.id)).at(-1)!.status).toBe("RELEASED");
  });

  it("skips an investment with a recovery that is not final: the recovery keeps its own 7-day stop (review I7)", async () => {
    const { op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    await addRecovery(op.id, buys[1]!);
    await adminSql`UPDATE app.operations SET needs_action_since = now() - interval '25 hours' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '25 hours' WHERE operation_id = ${op.id}`;
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("IN_PROGRESS");
  });

  it("does nothing while a leg is unknown, and never touches an operation without groups", async () => {
    const { op, buys } = await sent(["ok", "fail", "ok", "ok"]);
    await adminSql`UPDATE app.operations SET needs_action_since = now() - interval '25 hours' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_groups SET created_at = now() - interval '25 hours' WHERE operation_id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'UNKNOWN' WHERE id = ${buys[0]!.id}`;
    await stopStalledInvests();
    expect((await opRow(op.id)).status).toBe("IN_PROGRESS");

    await resetDb();
    const plain = await arrange();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS', needs_action_since = now() - interval '25 hours' WHERE id = ${plain.op.id}`;
    await stopStalledInvests();
    expect((await opRow(plain.op.id)).status).toBe("IN_PROGRESS");
  });
});
