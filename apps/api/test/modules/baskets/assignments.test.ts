import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../../helpers/db";
import { addMember, memberAction, membershipAction, type Actor } from "../members/helpers";
import { resetOrgDb } from "../organizations/helpers";
import { assignmentsOf, basketOrg, basketRow, createBasket, eventKinds, forceStatus, getBasket, post, save } from "./helpers";

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let lead: Actor;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  lead = await addMember(app, ctx.owner.id, "MANAGER");
});
beforeEach(() => redis.flushdb());

const assign = (h: Record<string, string>, bid: string, body: object) => post(h, `/v1/baskets/${bid}/assignments`, body);
const fresh = () => createBasket(lead.h, ctx.owner.id);
const manager = () => addMember(app, ctx.owner.id, "MANAGER");

describe("add assignment", () => {
  it("needs an ACTIVE member of the same organization holding baskets.manage", async () => {
    const b = await fresh();
    const analyst = await assign(lead.h, b.id, { membershipId: ctx.members.ANALYST.mid, role: "co_manager" });
    expect(analyst.status).toBe(409);
    expect(analyst.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "This member can't manage baskets." });
    const pending = await addMember(app, ctx.owner.id, "MANAGER", "PENDING_DOCUMENTS");
    expect((await assign(lead.h, b.id, { membershipId: pending.mid, role: "co_manager" })).status).toBe(409);
    const [other] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id <> ${ctx.owner.id} LIMIT 1`;
    if (other) expect((await assign(lead.h, b.id, { membershipId: other.id, role: "co_manager" })).status).toBe(404);
    expect((await assign(lead.h, b.id, { membershipId: "11111111-1111-4111-8111-111111111111", role: "co_manager" })).status).toBe(404);
    expect((await assignmentsOf(b.id))).toHaveLength(1);
  });

  it("gives a co-manager the default flags or the flags asked for, and refuses a second assignment", async () => {
    const b = await fresh();
    const m = await manager();
    const res = await assign(lead.h, b.id, { membershipId: m.mid, role: "co_manager" });
    expect(res.status).toBe(201);
    expect(res.body.assignments.find((a: { membershipId: string }) => a.membershipId === m.mid)).toMatchObject({ role: "co_manager", status: "ACTIVE", permissions: ["edit", "submit"] });
    const again = await assign(lead.h, b.id, { membershipId: m.mid, role: "co_manager" });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe("This member is already assigned.");
    const m2 = await manager();
    const custom = await assign(lead.h, b.id, { membershipId: m2.mid, role: "co_manager", permissions: ["publish", "lifecycle"] });
    expect(custom.body.assignments.find((a: { membershipId: string }) => a.membershipId === m2.mid).permissions).toEqual(["publish", "lifecycle"]);
    expect((await assign(lead.h, b.id, { membershipId: (await manager()).mid, role: "co_manager", permissions: ["delete"] })).status).toBe(400);
  });

  it("replaces the lead at once on an unpublished basket", async () => {
    const b = await fresh();
    const next = await manager();
    const res = await assign(lead.h, b.id, { membershipId: next.mid, role: "lead", permissions: ["edit"] });
    expect(res.status).toBe(201);
    const rows = await assignmentsOf(b.id);
    expect(rows.map((r) => [r.role, r.status, r.end_reason])).toEqual([["lead", "ENDED", "replaced"], ["lead", "ACTIVE", null]]);
    expect(rows[1]!.permissions).toEqual(["edit", "submit", "publish", "lifecycle", "assign"]);
    expect((await save(lead.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "x" })).status).toBe(403);
    expect(await eventKinds(b.id)).toEqual(["created", "assignment_ended", "assignment_added"]);
  });

  it("makes a new lead of a published basket PENDING_APPROVAL while the old lead stays", async () => {
    const b = await fresh();
    await forceStatus(b.id, "published");
    const next = await manager();
    expect((await assign(lead.h, b.id, { membershipId: next.mid, role: "lead" })).status).toBe(201);
    expect((await assignmentsOf(b.id)).map((r) => [r.role, r.status])).toEqual([["lead", "ACTIVE"], ["lead", "PENDING_APPROVAL"]]);
    expect((await save(lead.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "old lead still edits" })).status).not.toBe(403);
    expect((await save(next.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "pending lead cannot" })).status).toBe(403);
    const second = await assign(lead.h, b.id, { membershipId: (await manager()).mid, role: "lead" });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe("A new lead is already waiting for approval.");
  });
});

describe("update and end", () => {
  it("edits a co-manager's flags but never a lead's", async () => {
    const b = await fresh();
    const m = await manager();
    const detail = (await assign(lead.h, b.id, { membershipId: m.mid, role: "co_manager" })).body;
    const coId = detail.assignments.find((a: { membershipId: string }) => a.membershipId === m.mid).id;
    const leadId = detail.assignments.find((a: { role: string }) => a.role === "lead").id;
    const ok = await request(app).patch(`/v1/baskets/${b.id}/assignments/${coId}`).set(lead.h).send({ permissions: ["edit", "submit", "publish"] });
    expect(ok.status).toBe(200);
    expect((await assignmentsOf(b.id)).find((r) => r.id === coId)!.permissions).toEqual(["edit", "submit", "publish"]);
    const refused = await request(app).patch(`/v1/baskets/${b.id}/assignments/${leadId}`).set(lead.h).send({ permissions: ["edit"] });
    expect(refused.status).toBe(403);
    expect((await request(app).patch(`/v1/baskets/${b.id}/assignments/${coId}`).set(m.h).send({ permissions: ["edit"] })).status).toBe(403);
  });

  it("lets an assign holder end any assignment and anyone end their own, with a reason", async () => {
    const b = await fresh();
    const [m1, m2] = [await manager(), await manager()];
    const d = (await assign(lead.h, b.id, { membershipId: m1.mid, role: "co_manager" })).body;
    await assign(lead.h, b.id, { membershipId: m2.mid, role: "co_manager" });
    const id1 = d.assignments.find((a: { membershipId: string }) => a.membershipId === m1.mid).id;
    const id2 = (await assignmentsOf(b.id)).find((r) => r.user_id === m2.userId)!.id;
    const end = (h: Record<string, string>, aid: string, reason = "done") => post(h, `/v1/baskets/${b.id}/assignments/${aid}/end`, { reason });
    expect((await end(m1.h, id2)).status).toBe(403);
    expect((await end(m1.h, id1, "")).status).toBe(400);
    expect((await end(m1.h, id1, "stepping down")).status).toBe(200);
    expect((await end(lead.h, id2)).status).toBe(200);
    expect((await end(lead.h, id2)).status).toBe(409);
    expect((await assignmentsOf(b.id)).filter((r) => r.status === "ENDED").map((r) => r.end_reason).sort()).toEqual(["done", "stepping down"]);
    expect((await save(m1.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "x" })).status).toBe(403);
  });

  it("ending the last lead of a live basket requires reassignment; before publication it does not", async () => {
    const draft = await fresh();
    const leadId = (await assignmentsOf(draft.id))[0]!.id;
    expect((await post(ctx.owner.h, `/v1/baskets/${draft.id}/assignments/${leadId}/end`, { reason: "leaving" })).status).toBe(200);
    expect((await basketRow(draft.id)).status).toBe("DRAFT");

    const live = await fresh();
    await forceStatus(live.id, "published");
    const liveLead = (await assignmentsOf(live.id))[0]!.id;
    expect((await post(ctx.owner.h, `/v1/baskets/${live.id}/assignments/${liveLead}/end`, { reason: "leaving" })).status).toBe(200);
    expect(await basketRow(live.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "ACTIVE" });
    expect(await eventKinds(live.id)).toContain("reassignment_required");
    // The basket still has its OWNER, who can read it and start the replacement.
    expect((await getBasket(ctx.owner.h, live.id)).body.status).toBe("REASSIGNMENT_REQUIRED");
  });
});

describe("manager-leaves hook", () => {
  it("ends assignments and sets REASSIGNMENT_REQUIRED when the lead's membership is removed; the old lead is locked out", async () => {
    const l = await addMember(app, ctx.owner.id, "MANAGER");
    const b = await createBasket(l.h, ctx.owner.id);
    await forceStatus(b.id, "published");
    const removed = await memberAction(app, ctx.owner.h, ctx.owner.id, l.mid, "remove");
    expect(removed.status).toBe(200);
    expect((await assignmentsOf(b.id))[0]).toMatchObject({ status: "ENDED", end_reason: "membership_changed" });
    expect(await basketRow(b.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "ACTIVE" });
    const kinds = await eventKinds(b.id);
    expect(kinds).toEqual(expect.arrayContaining(["assignment_ended", "reassignment_required"]));
    const after = await save(l.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "still here?" });
    expect(after.status).toBe(403);
    expect((await getBasket(l.h, b.id)).status).toBe(403);
    const [audit] = await adminSql<{ n: number }[]>`SELECT count(*)::int AS n FROM app.audit_events WHERE action = 'basket.assignment_ended' AND entity_type = 'basket_assignment'`;
    expect(audit!.n).toBeGreaterThan(0);
  });

  it("remembers PAUSED as the previous status", async () => {
    const l = await addMember(app, ctx.owner.id, "MANAGER");
    const b = await createBasket(l.h, ctx.owner.id);
    await forceStatus(b.id, "published");
    await adminSql`UPDATE app.baskets SET status = 'PAUSED' WHERE id = ${b.id}`;
    await memberAction(app, ctx.owner.h, ctx.owner.id, l.mid, "remove");
    expect(await basketRow(b.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "PAUSED" });
  });

  it("ends assignments when a role change removes baskets.manage, and leaves the basket alone while a lead remains", async () => {
    const l = await addMember(app, ctx.owner.id, "MANAGER");
    const c = await addMember(app, ctx.owner.id, "MANAGER");
    const b = await createBasket(l.h, ctx.owner.id);
    await forceStatus(b.id, "published");
    await assign(l.h, b.id, { membershipId: c.mid, role: "co_manager" });
    expect((await memberAction(app, ctx.owner.h, ctx.owner.id, c.mid, "role", { role: "ANALYST" })).status).toBe(200);
    expect((await assignmentsOf(b.id)).map((r) => [r.role, r.status])).toEqual([["lead", "ACTIVE"], ["co_manager", "ENDED"]]);
    expect((await basketRow(b.id)).status).toBe("ACTIVE");
    // Downgrading the lead (MANAGER -> VIEWER) does trigger reassignment.
    expect((await memberAction(app, ctx.owner.h, ctx.owner.id, l.mid, "role", { role: "VIEWER" })).status).toBe(200);
    expect(await basketRow(b.id)).toMatchObject({ status: "REASSIGNMENT_REQUIRED", previous_status: "ACTIVE" });
  });

  it("ends a co-manager's assignment when they leave and ends a pending lead without touching the basket", async () => {
    const l = await addMember(app, ctx.owner.id, "MANAGER");
    const c = await addMember(app, ctx.owner.id, "MANAGER");
    const p = await addMember(app, ctx.owner.id, "MANAGER");
    const b = await createBasket(l.h, ctx.owner.id);
    await forceStatus(b.id, "published");
    await assign(l.h, b.id, { membershipId: c.mid, role: "co_manager" });
    await assign(l.h, b.id, { membershipId: p.mid, role: "lead" });
    expect((await membershipAction(app, c.h, c.mid, "leave")).status).toBe(200);
    await memberAction(app, ctx.owner.h, ctx.owner.id, p.mid, "remove");
    expect((await assignmentsOf(b.id)).map((r) => r.status)).toEqual(["ACTIVE", "ENDED", "ENDED"]);
    expect((await basketRow(b.id)).status).toBe("ACTIVE");
  });
});

describe("grants", () => {
  it("the runtime role can read, insert and update basket tables but never delete", async () => {
    const tables = ["baskets", "basket_slug_aliases", "basket_versions", "basket_version_assets", "disclosure_templates", "basket_version_disclosures", "basket_assignments", "basket_reviews", "basket_events"];
    for (const t of tables) {
      const [p] = await adminSql<{ del: boolean; sel: boolean; ins: boolean; upd: boolean }[]>`
        SELECT has_table_privilege('bytesac_api', ${`app.${t}`}, 'DELETE') AS del, has_table_privilege('bytesac_api', ${`app.${t}`}, 'SELECT') AS sel,
               has_table_privilege('bytesac_api', ${`app.${t}`}, 'INSERT') AS ins, has_table_privilege('bytesac_api', ${`app.${t}`}, 'UPDATE') AS upd`;
      expect(p, t).toEqual({ del: false, sel: true, ins: true, upd: true });
    }
    const rows = await adminSql`SELECT key FROM app.disclosure_templates WHERE status = 'active' ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual(["fees_and_costs", "no_guarantee", "platform_fee", "rwa_issuer_transfer_redemption", "self_custody_wallet", "stablecoin_depeg", "user_consent_rebalance"]);
  });
});

describe("assignment lockdown (ADR-011)", () => {
  /** A basket led by `lead` with a co-manager holding `assign` (`co`) and a plain co-manager (`plain`). */
  async function setup() {
    const b = await fresh();
    const [co, plain] = [await manager(), await manager()];
    await assign(lead.h, b.id, { membershipId: co.mid, role: "co_manager", permissions: ["edit", "assign"] });
    await assign(lead.h, b.id, { membershipId: plain.mid, role: "co_manager" });
    const rows = await assignmentsOf(b.id);
    const idOf = (u: string) => rows.find((r) => r.user_id === u)!.id;
    return { b, co, plain, leadAid: idOf(lead.userId), coAid: idOf(co.userId), plainAid: idOf(plain.userId), next: await manager() };
  }
  type S = Awaited<ReturnType<typeof setup>>;
  const patch = (h: Record<string, string>, s: S, aid: string) => request(app).patch(`/v1/baskets/${s.b.id}/assignments/${aid}`).set(h).send({ permissions: ["edit", "submit", "publish"] });
  const end = (h: Record<string, string>, s: S, aid: string) => post(h, `/v1/baskets/${s.b.id}/assignments/${aid}/end`, { reason: "done" });
  const addLead = (h: Record<string, string>, s: S) => assign(h, s.b.id, { membershipId: s.next.mid, role: "lead" });

  const table: [string, (s: S) => Promise<{ status: number }>, number][] = [
    ["co-manager with assign adds a lead", (s) => addLead(s.co.h, s), 403],
    ["co-manager with assign ends the lead", (s) => end(s.co.h, s, s.leadAid), 403],
    ["co-manager with assign edits their own flags", (s) => patch(s.co.h, s, s.coAid), 403],
    ["co-manager with assign edits another co-manager", (s) => patch(s.co.h, s, s.plainAid), 200],
    ["co-manager with assign adds a co-manager", (s) => assign(s.co.h, s.b.id, { membershipId: s.next.mid, role: "co_manager" }), 201],
    ["co-manager with assign ends another co-manager", (s) => end(s.co.h, s, s.plainAid), 200],
    ["co-manager leaves on their own", (s) => end(s.plain.h, s, s.plainAid), 200],
    ["co-manager without assign ends another co-manager", (s) => end(s.plain.h, s, s.coAid), 403],
    ["lead ends their own lead role", (s) => end(lead.h, s, s.leadAid), 403],
    ["lead edits their own flags", (s) => patch(lead.h, s, s.leadAid), 403],
    ["lead adds a new lead", (s) => addLead(lead.h, s), 201],
    ["lead ends a co-manager", (s) => end(lead.h, s, s.coAid), 200],
    ["OWNER replaces the lead", (s) => addLead(ctx.owner.h, s), 201],
    ["ADMIN replaces the lead", (s) => addLead(ctx.members.ADMIN.h, s), 201],
    ["ADMIN ends the lead", (s) => end(ctx.members.ADMIN.h, s, s.leadAid), 200],
    ["MANAGER without an assignment adds a lead", (s) => addLead(s.next.h, s), 403],
  ];
  it.each(table)("%s -> %i", async (_name, run, status) => {
    const s = await setup();
    expect((await run(s)).status).toBe(status);
  });

  it("the OWNER who leads cannot end their own lead role", async () => {
    const b = await createBasket(ctx.owner.h, ctx.owner.id);
    const [mine] = await assignmentsOf(b.id);
    expect((await post(ctx.owner.h, `/v1/baskets/${b.id}/assignments/${mine!.id}/end`, { reason: "x" })).status).toBe(403);
    expect((await assignmentsOf(b.id))[0]!.status).toBe("ACTIVE");
  });
});
