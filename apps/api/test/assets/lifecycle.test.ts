import { beforeEach, describe, expect, it } from "vitest";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { act, activeCrypto, admin, decide, evmAddress, get, itemAct, mkAsset, mkDeployment, mkProvider, mkRoute, post, readyCrypto, reviewer, submit } from "./helpers";

beforeEach(resetDb);

const status = async (table: string, id: string) => (await adminSql<{ status: string }[]>`SELECT status FROM ${adminSql(`app.${table}`)} WHERE id = ${id}`)[0]!.status;
const itemStatuses = async (id: string) => ((await get((await admin()).h, `/v1/ops/assets/${id}`)).body.deployments as Array<{ status: string }>).map((d) => d.status);

describe("instrument lifecycle", () => {
  it("activate cascades to APPROVED items only", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await readyCrypto(r.h);
    await submit(r.h, id);
    await decide(a.h, id, { decision: "approved" });
    const late = await mkDeployment(r.h, id, { chain: "base", address: evmAddress() });
    expect((await act(a.h, id, "activate")).body.status).toBe("ACTIVE");
    expect(await itemStatuses(id)).toEqual(["ACTIVE", "DRAFT"]);
    expect(await status("instrument_deployments", late)).toBe("DRAFT");
    expect(await adminSql`SELECT 1 FROM app.asset_events WHERE kind = 'activated' AND entity_type = 'deployment'`).toHaveLength(1);
  });

  it("pause and resume; resume from ACTIVE and activate from PAUSED are refused", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await activeCrypto(r, a);
    expect((await act(a.h, id, "resume")).status).toBe(409);
    expect((await act(a.h, id, "pause")).body.status).toBe("PAUSED");
    expect(await itemStatuses(id)).toEqual(["ACTIVE"]);
    const again = await act(a.h, id, "activate");
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
    expect((await act(a.h, id, "pause")).status).toBe(409);
    expect((await act(a.h, id, "resume")).body.status).toBe("ACTIVE");
    expect(await adminSql`SELECT kind FROM app.asset_events WHERE entity_type = 'instrument' AND kind IN ('paused', 'resumed', 'activated') ORDER BY created_at`).toEqual([{ kind: "activated" }, { kind: "paused" }, { kind: "resumed" }]);
  });

  it("deprecate then retire; ACTIVE cannot be retired directly", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await activeCrypto(r, a);
    const direct = await act(a.h, id, "retire");
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe("INVALID_TRANSITION");
    expect((await act(a.h, id, "deprecate")).body.status).toBe("DEPRECATED");
    expect((await act(a.h, id, "resume")).status).toBe(409);
    expect((await act(a.h, id, "retire")).body.status).toBe("RETIRED");
    expect((await act(a.h, id, "retire")).status).toBe(409);
    expect(await itemStatuses(id)).toEqual(["RETIRED"]);
  });

  it("retiring a DRAFT instrument retires its items and frees their tokens", async () => {
    const r = await reviewer();
    const a = await admin();
    const address = evmAddress();
    const id = await mkAsset(r.h);
    const did = await mkDeployment(r.h, id, { address });
    const provider = await mkProvider(r.h);
    const rid = await mkRoute(r.h, id, did, provider);
    expect((await act(a.h, id, "retire")).body.status).toBe("RETIRED");
    expect(await status("instrument_deployments", did)).toBe("RETIRED");
    expect(await status("execution_routes", rid)).toBe("RETIRED");
    const other = await mkAsset(r.h, { name: "Other", symbol: "OTH" });
    expect((await post(r.h, `/v1/ops/assets/${other}/deployments`, { chain: "ethereum", tokenStandard: "erc20", address, decimals: 18 })).status).toBe(201);
  });

  it("an UNDER_REVIEW instrument can't be activated or paused", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await readyCrypto(r.h);
    await submit(r.h, id);
    for (const action of ["activate", "pause", "resume", "deprecate", "retire"]) expect((await act(a.h, id, action)).status).toBe(409);
  });

  it("a reviewer gets 403 on every admin route and nothing changes", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await activeCrypto(r, a);
    const routeId = await mkRoute(r.h, id, deploymentId, await mkProvider(r.h));
    for (const action of ["activate", "pause", "resume", "deprecate", "retire"]) expect((await act(r.h, id, action)).status).toBe(403);
    for (const kind of ["deployments", "routes"] as const) {
      for (const action of ["approve", "activate", "pause", "resume", "retire"]) expect((await itemAct(r.h, id, kind, kind === "routes" ? routeId : deploymentId, action)).status).toBe(403);
    }
    expect((await decide(r.h, id, { decision: "approved" })).status).toBe(403);
    expect(await status("instruments", id)).toBe("ACTIVE");
    expect(await status("instrument_deployments", deploymentId)).toBe("ACTIVE");
  });
});

describe("item lifecycle", () => {
  it("an item added to an ACTIVE instrument stays DRAFT until approve + activate, and the instrument stays readable", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await activeCrypto(r, a);
    const late = await mkDeployment(r.h, id, { chain: "base", address: evmAddress() });
    const readable = async () => (await get(r.h, `/v1/assets/${id}`)).body;
    expect((await readable()).deployments).toHaveLength(1);
    expect((await itemAct(a.h, id, "deployments", late, "activate")).status).toBe(409);
    expect((await itemAct(a.h, id, "deployments", late, "approve")).status).toBe(200);
    expect(await status("instrument_deployments", late)).toBe("APPROVED");
    expect((await readable()).deployments).toHaveLength(1);
    expect((await itemAct(a.h, id, "deployments", late, "activate")).status).toBe(200);
    expect((await readable()).deployments.map((d: { chain: string }) => d.chain)).toEqual(["ethereum", "base"]);
    expect(await adminSql`SELECT approved_by_user_id FROM app.instrument_deployments WHERE id = ${late}`).toEqual([{ approved_by_user_id: a.userId }]);
  });

  it("approving a deployment whose decimals differ from the chain is refused with deployment_verification", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await activeCrypto(r, a);
    fakes.evm.token = { decimals: 6, symbol: "X", name: "X" };
    const late = await mkDeployment(r.h, id, { chain: "base", address: evmAddress(), decimals: 18 });
    const res = await itemAct(a.h, id, "deployments", late, "approve");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "REQUIREMENTS_INCOMPLETE", details: { missing: ["deployment_verification"] } });
    expect(await status("instrument_deployments", late)).toBe("DRAFT");
  });

  it("a manual deployment needs its source URL to be approved", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id } = await activeCrypto(r, a);
    const late = await mkDeployment(r.h, id, { chain: "polygon", address: evmAddress() });
    expect((await itemAct(a.h, id, "deployments", late, "approve")).body.error.details.missing).toEqual(["deployment_source_url"]);
    await adminSql`UPDATE app.instrument_deployments SET source_url = 'https://polygonscan.com/x' WHERE id = ${late}`;
    expect((await itemAct(a.h, id, "deployments", late, "approve")).status).toBe(200);
  });

  it("items cannot be approved before the instrument is", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    const res = await itemAct(a.h, id, "deployments", deploymentId, "approve");
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("The asset must be approved first.");
  });

  it("a route needs a live deployment; item pause, resume and retire follow the transition map", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await activeCrypto(r, a);
    const late = await mkDeployment(r.h, id, { chain: "base", address: evmAddress() });
    const route = await mkRoute(r.h, id, late, await mkProvider(r.h));
    await adminSql`UPDATE app.instrument_deployments SET status = 'RETIRED' WHERE id = ${late}`;
    const refused = await itemAct(a.h, id, "routes", route, "approve");
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.missing).toEqual(["deployment"]);

    const live = await mkRoute(r.h, id, deploymentId, await mkProvider(r.h));
    expect((await itemAct(a.h, id, "routes", live, "approve")).status).toBe(200);
    expect((await itemAct(a.h, id, "routes", live, "resume")).status).toBe(409);
    expect((await itemAct(a.h, id, "routes", live, "activate")).status).toBe(200);
    expect((await itemAct(a.h, id, "routes", live, "pause")).status).toBe(200);
    expect((await itemAct(a.h, id, "routes", live, "resume")).status).toBe(200);
    expect((await itemAct(a.h, id, "routes", live, "retire")).status).toBe(200);
    expect((await itemAct(a.h, id, "routes", live, "pause")).status).toBe(409);
    expect((await itemAct(a.h, id, "routes", crypto.randomUUID(), "approve")).status).toBe(404);
    expect((await itemAct(a.h, id, "deployments", live, "approve")).status).toBe(404);
  });

  it("a retired instrument and an UNDER_REVIEW one refuse item actions", async () => {
    const r = await reviewer();
    const a = await admin();
    const { id, deploymentId } = await readyCrypto(r.h);
    await submit(r.h, id);
    const res = await itemAct(a.h, id, "deployments", deploymentId, "retire");
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("This asset is under review.");
  });
});
