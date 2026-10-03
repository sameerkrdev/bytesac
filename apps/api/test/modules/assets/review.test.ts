import { beforeEach, describe, expect, it } from "vitest";
import { adminSql, resetDb } from "../../helpers/db";
import { admin, decide, evmAddress, get, mkAsset, mkDeployment, mkIssuer, mkProvider, mkRoute, mkRule, patch, post, putRef, readyCrypto, reviewer, submit } from "./helpers";

beforeEach(resetDb);

const status = async (id: string) => (await adminSql<{ status: string }[]>`SELECT status FROM app.instruments WHERE id = ${id}`)[0]!.status;
const events = (id: string) => adminSql<{ entity_type: string; kind: string; from_status: string | null; to_status: string | null; message: string | null; internal_note: string | null; actor_user_id: string }[]>`
  SELECT entity_type, kind, from_status, to_status, message, internal_note, actor_user_id FROM app.asset_events WHERE instrument_id = ${id} ORDER BY created_at, id`;
const audits = (action: string) => adminSql`SELECT 1 FROM app.audit_events WHERE action = ${action}`;

describe("submit", () => {
  it("an incomplete CRYPTO instrument gets 422 with the exact missing keys, and stays DRAFT", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h);
    const res = await submit(r.h, id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "REQUIREMENTS_INCOMPLETE", details: { missing: ["deployment", "market_price_reference"] } });
    expect(await status(id)).toBe("DRAFT");
  });

  it("an incomplete RWA gets issuer, route and eligibility_rule; a complete one submits", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "T-Bill Fund", symbol: "TBF", assetType: "TOKENIZED_TREASURY" });
    const did = await mkDeployment(r.h, id);
    expect((await submit(r.h, id)).body.error.details.missing).toEqual(["issuer", "route", "eligibility_rule"]);
    await patch(r.h, `/v1/ops/assets/${id}`, { issuerId: await mkIssuer(r.h) });
    await mkRoute(r.h, id, did, await mkProvider(r.h));
    await mkRule(r.h, id);
    const res = await submit(r.h, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "UNDER_REVIEW", submittedByUserId: r.userId, missing: [] });
  });

  it("only DRAFT or CHANGES_REQUIRED can be submitted", async () => {
    const r = await reviewer();
    const { id } = await readyCrypto(r.h);
    expect((await submit(r.h, id)).status).toBe(200);
    const again = await submit(r.h, id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("anonymous gets 401", async () => {
    const r = await reviewer();
    const { id } = await readyCrypto(r.h);
    expect((await submit({}, id)).status).toBe(401);
  });
});

describe("review cycle", () => {
  it("draft -> submit -> changes required -> edit -> resubmit -> approve, with events and audit rows", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    expect((await submit(r.h, id)).status).toBe(200);

    expect((await decide(a.h, id, { decision: "changes_required" })).status).toBe(400);
    const changes = await decide(a.h, id, { decision: "changes_required", message: "Add a risk note", internalNote: "thin submission" });
    expect(changes.status).toBe(200);
    expect(changes.body).toMatchObject({ status: "CHANGES_REQUIRED", decidedByUserId: a.userId });

    expect((await patch(r.h, `/v1/ops/assets/${id}`, { riskNotes: "Volatile" })).status).toBe(200);
    expect((await submit(r.h, id)).body.status).toBe("UNDER_REVIEW");
    const approved = await decide(a.h, id, { decision: "approved", internalNote: "ok" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.deployments.find((d: { id: string }) => d.id === deploymentId)).toMatchObject({ status: "APPROVED", approvedByUserId: a.userId });

    const kinds = (await events(id)).map((e) => `${e.entity_type}:${e.kind}`);
    expect(kinds).toEqual([
      "instrument:created", "deployment:created", "price:created", "instrument:submitted", "instrument:decided", "instrument:updated", "instrument:submitted", "deployment:approved", "instrument:decided",
    ]);
    const decided = (await events(id)).filter((e) => e.kind === "decided");
    expect(decided[0]).toMatchObject({ from_status: "UNDER_REVIEW", to_status: "CHANGES_REQUIRED", message: "Add a risk note", internal_note: "thin submission", actor_user_id: a.userId });
    expect(decided[1]).toMatchObject({ to_status: "APPROVED", message: null, internal_note: "ok" });
    expect(await audits("asset.instrument.submitted")).toHaveLength(2);
    expect(await audits("asset.instrument.decided")).toHaveLength(2);
    expect(await audits("asset.deployment.approved")).toHaveLength(1);
    expect(JSON.stringify(await adminSql`SELECT metadata FROM app.audit_events WHERE action = 'asset.instrument.decided'`)).not.toContain("thin submission");
  });

  it("an admin who submitted cannot decide their own submission; another admin can (Review Focus 1)", async () => {
    const a = await admin();
    const other = await admin();
    const { id } = await readyCrypto(a.h);
    expect((await submit(a.h, id)).status).toBe(200);
    for (const body of [{ decision: "approved" }, { decision: "changes_required", message: "x" }]) {
      const res = await decide(a.h, id, body);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "FORBIDDEN", message: "You can't review a submission you made." });
    }
    expect(await status(id)).toBe("UNDER_REVIEW");
    expect((await get(a.h, `/v1/ops/assets/${id}`)).body.decidedByUserId).toBeNull();
    expect((await decide(other.h, id, { decision: "approved" })).status).toBe(200);
  });

  it("a reviewer cannot decide, and nothing is editable while UNDER_REVIEW", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    await submit(r.h, id);
    expect((await decide(r.h, id, { decision: "approved" })).status).toBe(403);
    expect(await status(id)).toBe("UNDER_REVIEW");
    for (const res of [
      await patch(r.h, `/v1/ops/assets/${id}`, { name: "Changed" }),
      await patch(r.h, `/v1/ops/assets/${id}/deployments/${deploymentId}`, { sourceUrl: "https://example.com" }),
      await putRef(r.h, id, "market", { externalId: "99" }),
      await patch(a.h, `/v1/ops/assets/${id}`, { name: "Changed" }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe("This asset is under review.");
    }
    expect((await get(r.h, `/v1/ops/assets/${id}`)).body.name).toBe("Solana");
  });

  it("deciding needs an asset waiting for review", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await readyCrypto(r.h);
    const res = await decide(a.h, id, { decision: "approved" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "This asset is not waiting for review." });
    expect((await decide(a.h, crypto.randomUUID(), { decision: "approved" })).status).toBe(404);
  });

  it("approval re-checks the requirements", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    await submit(r.h, id);
    await adminSql`UPDATE app.instrument_deployments SET observed_decimals = 6 WHERE id = ${deploymentId}`;
    const res = await decide(a.h, id, { decision: "approved" });
    expect(res.status).toBe(422);
    expect(res.body.error.details.missing).toEqual(["deployment_verification"]);
    expect(await status(id)).toBe("UNDER_REVIEW");
    expect((await get(a.h, `/v1/ops/assets/${id}`)).body.deployments[0].status).toBe("DRAFT");
  });

  it("approval leaves already-retired deployments alone and approves every DRAFT one", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    const second = await mkDeployment(r.h, id, { chain: "base", address: evmAddress() });
    await adminSql`UPDATE app.instrument_deployments SET status = 'RETIRED' WHERE id = ${second}`;
    await submit(r.h, id);
    const res = await decide(a.h, id, { decision: "approved" });
    expect(res.body.deployments.map((d: { id: string; status: string }) => [d.id === deploymentId, d.status])).toEqual([[true, "APPROVED"], [false, "RETIRED"]]);
    expect(await post(r.h, `/v1/ops/assets/${id}/submit`).then((x) => x.status)).toBe(409);
  });
});
