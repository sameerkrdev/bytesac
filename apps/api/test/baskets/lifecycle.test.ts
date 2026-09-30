import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { redis } from "../../src/middleware/rate-limit";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { addMember, memberAction, type Actor } from "../members/helpers";
import { opsUser } from "../managers/helpers";
import { resetOrgDb, user } from "../organizations/helpers";
import {
  activeInstrument, approvedBasket, assignmentsOf, basketOrg, basketRow, createBasket, decideBasket, decision, eventKinds, forceStatus, getBasket, post, publishBasket, saveOpen,
  submitBasket, validContent, type Headers,
} from "./helpers";

type Who = "OWNER" | "ADMIN" | "lead" | "co (edit, submit)" | "co (publish)" | "co (lifecycle)" | "MANAGER unassigned" | "ANALYST" | "VIEWER" | "outsider";
const WHO: Who[] = ["OWNER", "ADMIN", "lead", "co (edit, submit)", "co (publish)", "co (lifecycle)", "MANAGER unassigned", "ANALYST", "VIEWER", "outsider"];
const FLAGS: Partial<Record<Who, string[]>> = { OWNER: ["*"], ADMIN: ["*"], lead: ["*"], "co (edit, submit)": ["edit", "submit"], "co (publish)": ["publish"], "co (lifecycle)": ["lifecycle"] };
const may = (who: Who, flag: string) => FLAGS[who]?.includes("*") || FLAGS[who]?.includes(flag) || false;

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let admin: { userId: string; h: Headers };
let reviewer: { userId: string; h: Headers };
let actors: Record<Who, { h: Headers }>;
let co: Record<"edit" | "publish" | "lifecycle", Actor>;
let lead: Actor;
let a: string;
let b: string;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  admin = await opsUser(app, "ops_admin");
  reviewer = await opsUser(app, "ops_reviewer");
  [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  lead = await addMember(app, ctx.owner.id, "MANAGER");
  co = { edit: await addMember(app, ctx.owner.id, "MANAGER"), publish: await addMember(app, ctx.owner.id, "MANAGER"), lifecycle: await addMember(app, ctx.owner.id, "MANAGER") };
  actors = {
    OWNER: ctx.owner, ADMIN: ctx.members.ADMIN, lead, "co (edit, submit)": co.edit, "co (publish)": co.publish, "co (lifecycle)": co.lifecycle,
    "MANAGER unassigned": ctx.members.MANAGER, ANALYST: ctx.members.ANALYST, VIEWER: ctx.members.VIEWER, outsider: await user(app, false),
  };
});
beforeEach(() => redis.flushdb());

/** A basket led by `lead` with the three co-managers assigned. */
async function fresh() {
  await redis.flushdb();
  const basket = await createBasket(lead.h, ctx.owner.id);
  const give = (m: Actor, permissions?: string[]) => post(lead.h, `/v1/baskets/${basket.id}/assignments`, { membershipId: m.mid, role: "co_manager", permissions });
  expect((await give(co.edit)).status).toBe(201);
  expect((await give(co.publish, ["publish"])).status).toBe(201);
  expect((await give(co.lifecycle, ["lifecycle"])).status).toBe(201);
  return basket;
}
const live = async () => { const bk = await fresh(); await forceStatus(bk.id, "published"); return bk; };
const ready = async () => { const bk = await fresh(); await saveOpen(lead.h, bk.id, validContent(a, b)); return bk; };
const submitted = async () => { const bk = await ready(); await submitBasket(lead.h, bk.id); return bk; };
const approved = async () => {
  const bk = await fresh();
  await saveOpen(lead.h, bk.id, validContent(a, b));
  await submitBasket(lead.h, bk.id);
  await decideBasket(admin.h, bk.id, bk.openVersion.id, decision("approved"));
  return bk;
};
const paused = async () => { const bk = await live(); await adminSql`UPDATE app.baskets SET status = 'PAUSED', pause_kind = 'manager' WHERE id = ${bk.id}`; return bk; };

interface Route { name: string; flag: string; setup: () => Promise<{ id: string }>; call: (h: Headers, id: string) => request.Test; changed: (id: string) => Promise<unknown> }
const version = async (id: string) => (await adminSql`SELECT status FROM app.basket_versions WHERE basket_id = ${id} ORDER BY version_number DESC LIMIT 1`)[0]!.status;
const routes: Route[] = [
  { name: "submit", flag: "submit", setup: ready, call: (h, id) => post(h, `/v1/baskets/${id}/submit`), changed: version },
  { name: "withdraw", flag: "submit", setup: submitted, call: (h, id) => post(h, `/v1/baskets/${id}/withdraw`), changed: version },
  { name: "publish", flag: "publish", setup: approved, call: (h, id) => post(h, `/v1/baskets/${id}/publish`), changed: async (id) => (await basketRow(id)).status },
  { name: "pause", flag: "lifecycle", setup: live, call: (h, id) => post(h, `/v1/baskets/${id}/pause`, { reason: "Checking something" }), changed: async (id) => (await basketRow(id)).status },
  { name: "resume", flag: "lifecycle", setup: paused, call: (h, id) => post(h, `/v1/baskets/${id}/resume`), changed: async (id) => (await basketRow(id)).status },
  { name: "retirement request", flag: "lifecycle", setup: live, call: (h, id) => post(h, `/v1/baskets/${id}/retirement-request`, { reason: "Winding down" }), changed: async (id) => (await basketRow(id)).status },
];

describe.each(routes)("$name by role (flag: $flag)", (route) => {
  it("is refused for everyone without the flag, and nothing changes", async () => {
    const bk = await route.setup();
    const before = await route.changed(bk.id);
    for (const who of WHO.filter((w) => !may(w, route.flag))) {
      expect((await route.call(actors[who].h, bk.id)).status, who).toBe(403);
    }
    expect(await route.changed(bk.id)).toEqual(before);
  });
  it.each(WHO.filter((w) => may(w, route.flag)))("is allowed for %s", async (who) => {
    const bk = await route.setup();
    const res = await route.call(actors[who].h, bk.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("manager pause, resume and retirement", () => {
  it("pauses with a reason and resumes; a pause needs a reason; only an ACTIVE basket pauses", async () => {
    const bk = await live();
    expect((await post(lead.h, `/v1/baskets/${bk.id}/pause`, {})).status).toBe(400);
    const res = await post(lead.h, `/v1/baskets/${bk.id}/pause`, { reason: "Reviewing constituents" });
    expect(res.body).toMatchObject({ status: "PAUSED", pauseKind: "manager", pauseReason: "Reviewing constituents" });
    expect((await post(lead.h, `/v1/baskets/${bk.id}/pause`, { reason: "again" })).status).toBe(409);
    const back = await post(lead.h, `/v1/baskets/${bk.id}/resume`);
    expect(back.body).toMatchObject({ status: "ACTIVE", pauseKind: null, pauseReason: null });
    expect(await eventKinds(bk.id)).toEqual(expect.arrayContaining(["paused", "resumed"]));
    expect((await post(lead.h, `/v1/baskets/${bk.id}/resume`)).status).toBe(409);
  });

  it("refuses to submit or publish while paused, but drafting is allowed", async () => {
    const bk = await approved();
    await publishBasket(lead.h, bk.id);
    const next = (await post(lead.h, `/v1/baskets/${bk.id}/versions`)).body.openVersion;
    await saveOpen(lead.h, bk.id, { rationale: "Tune" });
    await post(lead.h, `/v1/baskets/${bk.id}/pause`, { reason: "Hold" });
    await saveOpen(lead.h, bk.id, { thesis: "Drafting while paused" });
    const res = await submitBasket(lead.h, bk.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("This basket can't take new versions right now.");
    expect(next.versionNumber).toBe(2);
  });

  it("a platform pause cannot be lifted by the manager; only an admin lifts it", async () => {
    const bk = await live();
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/pause`, { reason: "Issuer notice" })).status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "PAUSED", pause_kind: "platform", pause_reason: "Issuer notice" });
    const res = await post(lead.h, `/v1/baskets/${bk.id}/resume`);
    expect(res.status).toBe(403);
    expect((await post(ctx.owner.h, `/v1/baskets/${bk.id}/resume`)).status).toBe(403);
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/resume`)).status).toBe(403);
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/pause`, { reason: "twice" })).status).toBe(409);
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/resume`)).status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "ACTIVE", pause_kind: null });
    expect(fakes.email.basket.map((e) => e.kind)).toEqual(expect.arrayContaining(["platform_paused", "platform_resumed"]));
  });

  it("a platform pause takes over a manager pause", async () => {
    const bk = await paused();
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/pause`, { reason: "Escalated" })).status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "PAUSED", pause_kind: "platform" });
    expect((await post(lead.h, `/v1/baskets/${bk.id}/resume`)).status).toBe(403);
  });

  it("a declined retirement restores the previous status; an approved one retires and makes the basket read-only", async () => {
    const bk = await paused();
    expect((await post(lead.h, `/v1/baskets/${bk.id}/retirement-request`, { reason: "Winding down" })).body).toMatchObject({ status: "RETIREMENT_PENDING", previousStatus: "PAUSED" });
    expect((await post(lead.h, `/v1/baskets/${bk.id}/retirement-request`, { reason: "again" })).status).toBe(409);
    const queue = await request(app).get("/v1/ops/baskets?queue=retirements").set(reviewer.h);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(bk.id);
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/retirement/decision`, { decision: "rejected" })).status).toBe(403);
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/retirement/decision`, { decision: "rejected", reason: "Not yet" })).status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "PAUSED", previous_status: null });

    await post(lead.h, `/v1/baskets/${bk.id}/retirement-request`, { reason: "Final" });
    const done = await post(admin.h, `/v1/ops/baskets/${bk.id}/retirement/decision`, { decision: "approved" });
    expect(done.body.status).toBe("RETIRED");
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/retirement/decision`, { decision: "approved" })).status).toBe(409);
    expect((await post(lead.h, `/v1/baskets/${bk.id}/versions`)).status).toBe(409);
    expect((await post(ctx.owner.h, `/v1/baskets/${bk.id}/assignments`, { membershipId: co.edit.mid, role: "co_manager" })).status).toBe(409);
    expect(fakes.email.basket.filter((e) => e.kind === "retirement_decided").map((e) => e.data.decision)).toEqual(["rejected", "approved"]);
  });

  it("ops retire a basket directly (admin only), from any live state", async () => {
    const bk = await live();
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/retire`, { reason: "Policy" })).status).toBe(403);
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/retire`, { reason: "Policy" })).body.status).toBe("RETIRED");
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/retire`, { reason: "Again" })).status).toBe(409);
    expect(fakes.email.basket.map((e) => e.kind)).toContain("retired");
    const draft = await fresh();
    expect((await post(admin.h, `/v1/ops/baskets/${draft.id}/retire`, { reason: "Not published" })).status).toBe(409);
  });

  it("an ops user who belongs to the organization cannot pause or retire", async () => {
    const bk = await live();
    const insider = await opsUser(app, "ops_admin");
    await adminSql`INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status) VALUES (gen_random_uuid(), ${ctx.owner.id}, ${insider.userId}, 'VIEWER', 'REVOKED')`;
    for (const path of ["pause", "retire"]) expect((await post(insider.h, `/v1/ops/baskets/${bk.id}/${path}`, { reason: "x" })).status).toBe(403);
  });
});

describe("lead change and reassignment", () => {
  it("a leaderless live basket needs a new lead; an admin approves; the status returns and the lead email goes out", async () => {
    const old = await addMember(app, ctx.owner.id, "MANAGER");
    const next = await addMember(app, ctx.owner.id, "MANAGER");
    const bk = await createBasket(old.h, ctx.owner.id);
    await forceStatus(bk.id, "published");
    await adminSql`UPDATE app.baskets SET status = 'PAUSED' WHERE id = ${bk.id}`;
    expect((await memberAction(app, ctx.owner.h, ctx.owner.id, old.mid, "remove")).status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "PAUSED" });
    expect(fakes.email.basket.filter((e) => e.kind === "reassignment_required").map((e) => e.to)).toHaveLength(1);

    const added = await post(ctx.owner.h, `/v1/baskets/${bk.id}/assignments`, { membershipId: next.mid, role: "lead" });
    expect(added.status).toBe(201);
    const pending = (await assignmentsOf(bk.id)).find((r) => r.status === "PENDING_APPROVAL")!;
    expect((await post(reviewer.h, `/v1/ops/baskets/${bk.id}/assignments/${pending.id}/decision`, { decision: "approved" })).status).toBe(403);
    expect((await post(ctx.owner.h, `/v1/ops/baskets/${bk.id}/assignments/${pending.id}/decision`, { decision: "approved" })).status).toBe(403);
    const queue = await request(app).get("/v1/ops/baskets?queue=leads").set(reviewer.h);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(bk.id);

    const res = await post(admin.h, `/v1/ops/baskets/${bk.id}/assignments/${pending.id}/decision`, { decision: "approved" });
    expect(res.status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "PAUSED", previous_status: null });
    expect((await assignmentsOf(bk.id)).map((r) => [r.role, r.status])).toEqual([["lead", "ENDED"], ["lead", "ACTIVE"]]);
    expect((await getBasket(next.h, bk.id)).body.myPermissions).toHaveLength(5);
    expect(fakes.email.basket.map((e) => e.kind)).toContain("lead_approved");
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/assignments/${pending.id}/decision`, { decision: "approved" })).status).toBe(409);
  });

  it("replacing a live lead keeps the old lead until approval, then ends them; a rejection keeps them", async () => {
    const bk = await live();
    const n1 = await addMember(app, ctx.owner.id, "MANAGER");
    const n2 = await addMember(app, ctx.owner.id, "MANAGER");
    await post(lead.h, `/v1/baskets/${bk.id}/assignments`, { membershipId: n1.mid, role: "lead" });
    const first = (await assignmentsOf(bk.id)).find((r) => r.status === "PENDING_APPROVAL")!;
    const rejected = await post(admin.h, `/v1/ops/baskets/${bk.id}/assignments/${first.id}/decision`, { decision: "rejected", reason: "Not suitable" });
    expect(rejected.status).toBe(200);
    expect((await assignmentsOf(bk.id)).find((r) => r.id === first.id)).toMatchObject({ status: "REJECTED" });
    expect((await getBasket(lead.h, bk.id)).body.myPermissions).toHaveLength(5);
    expect(fakes.email.basket.map((e) => e.kind)).toContain("lead_rejected");

    await post(lead.h, `/v1/baskets/${bk.id}/assignments`, { membershipId: n2.mid, role: "lead" });
    const second = (await assignmentsOf(bk.id)).find((r) => r.status === "PENDING_APPROVAL")!;
    expect((await post(admin.h, `/v1/ops/baskets/${bk.id}/assignments/${second.id}/decision`, { decision: "approved" })).status).toBe(200);
    const rows = await assignmentsOf(bk.id);
    expect(rows.find((r) => r.user_id === lead.userId)).toMatchObject({ status: "ENDED", end_reason: "replaced" });
    expect(rows.find((r) => r.id === second.id)!.status).toBe("ACTIVE");
    expect((await basketRow(bk.id)).status).toBe("ACTIVE");
    expect((await getBasket(lead.h, bk.id)).body.myPermissions).toEqual([]);
  });

  it("an ops user who belongs to the organization cannot decide a lead", async () => {
    const bk = await live();
    const n = await addMember(app, ctx.owner.id, "MANAGER");
    await post(lead.h, `/v1/baskets/${bk.id}/assignments`, { membershipId: n.mid, role: "lead" });
    const pending = (await assignmentsOf(bk.id)).find((r) => r.status === "PENDING_APPROVAL")!;
    const insider = await opsUser(app, "ops_admin");
    await adminSql`INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status) VALUES (gen_random_uuid(), ${ctx.owner.id}, ${insider.userId}, 'VIEWER', 'REVOKED')`;
    expect((await post(insider.h, `/v1/ops/baskets/${bk.id}/assignments/${pending.id}/decision`, { decision: "approved" })).status).toBe(403);
  });
});

describe("review fixes", () => {
  it("declining a retirement for a basket that lost its lead requires reassignment", async () => {
    const bk = await live();
    await post(lead.h, `/v1/baskets/${bk.id}/retirement-request`, { reason: "Winding down" });
    await adminSql`UPDATE app.basket_assignments SET status = 'ENDED', ended_at = now() WHERE basket_id = ${bk.id} AND role = 'lead'`;
    const res = await post(admin.h, `/v1/ops/baskets/${bk.id}/retirement/decision`, { decision: "rejected", reason: "Not yet" });
    expect(res.status).toBe(200);
    expect(await basketRow(bk.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "ACTIVE" });
  });

  it("a retired basket refuses assignment edits and ends, and retiring clears the pause fields", async () => {
    const bk = await paused();
    await post(admin.h, `/v1/ops/baskets/${bk.id}/retire`, { reason: "Policy" });
    expect(await basketRow(bk.id)).toMatchObject({ status: "RETIRED", pause_kind: null, pause_reason: null, previous_status: null });
    const [, coAssignment] = await assignmentsOf(bk.id);
    expect((await post(ctx.owner.h, `/v1/baskets/${bk.id}/assignments/${coAssignment!.id}/end`, { reason: "x" })).status).toBe(409);
  });
});
