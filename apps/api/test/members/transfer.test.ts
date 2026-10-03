import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { grantRole } from "@/services/platform-roles";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { resetOrgDb, verifyEmail } from "../organizations/helpers";
import { opsUser } from "../managers/helpers";
import { addMember, eventsOf, rowOf, orgWithOwner } from "./helpers";

beforeEach(resetOrgDb);

const transfer = (h: Record<string, string>, orgId: string, body: object) => request(app).post(`/v1/ops/organizations/${orgId}/transfer-ownership`).set(h).send(body);
const REASON = "Owner asked support to hand over the organization.";

/** An active member with an approved member verification: eligible as the new owner. */
async function eligible(orgId: string, role: "ADMIN" | "MANAGER" = "ADMIN") {
  const m = await addMember(app, orgId, role);
  await adminSql`INSERT INTO app.member_verifications (id, membership_id, status) VALUES (gen_random_uuid(), ${m.mid}, 'approved')`;
  await verifyEmail(m.userId, `new-owner-${m.userId.slice(0, 8)}@example.com`);
  return m;
}
const owners = (orgId: string) => adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${orgId} AND role = 'OWNER' AND status = 'ACTIVE'`;

describe("ownership transfer", () => {
  it("only ops_admin may transfer: reviewers, members and anonymous are refused", async () => {
    const owner = await orgWithOwner(app);
    const target = await eligible(owner.id);
    const reviewer = await opsUser(app, "ops_reviewer");
    const body = { targetMembershipId: target.mid, reason: REASON };
    expect((await transfer(reviewer.h, owner.id, body)).status).toBe(403);
    expect((await transfer(owner.h, owner.id, body)).status).toBe(403);
    expect((await request(app).post(`/v1/ops/organizations/${owner.id}/transfer-ownership`).send(body)).status).toBe(401);
    expect(await owners(owner.id)).toEqual([{ id: owner.mid }]);
  });

  it("an ops_admin makes the target the OWNER and the old owner an ADMIN, with events, audit and emails", async () => {
    const owner = await orgWithOwner(app);
    const target = await eligible(owner.id, "MANAGER");
    const admin = await opsUser(app, "ops_admin");
    const res = await transfer(admin.h, owner.id, { targetMembershipId: target.mid, reason: REASON });
    expect(res.status).toBe(204);
    expect(await owners(owner.id)).toEqual([{ id: target.mid }]);
    expect(await rowOf(owner.mid)).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    expect(await rowOf(target.mid)).toMatchObject({ role: "OWNER", status: "ACTIVE", requested_role: null });
    for (const mid of [owner.mid, target.mid]) expect((await eventsOf(mid)).at(-1)!.kind).toBe("ownership_transferred");
    const events = await adminSql`SELECT membership_id, from_role, to_role, reason, actor_type FROM app.membership_events WHERE kind = 'ownership_transferred' ORDER BY to_role`;
    expect(events).toEqual([
      { membership_id: target.mid, from_role: "MANAGER", to_role: "OWNER", reason: REASON, actor_type: "ops" },
      { membership_id: owner.mid, from_role: "OWNER", to_role: "ADMIN", reason: REASON, actor_type: "ops" },
    ]);
    const audit = await adminSql`SELECT metadata FROM app.audit_events WHERE action = 'organization.ownership_transferred'`;
    expect(audit).toEqual([{ metadata: { reason: REASON, from: owner.mid, to: target.mid } }]);
    expect(fakes.email.membership.filter((m) => m.kind === "ownership_transferred").map((m) => m.data.role).sort()).toEqual(["ADMIN", "OWNER"]);
    // The new permissions apply immediately; the old owner lost owner-only ones.
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(target.h)).body.myRole).toBe("OWNER");
    expect((await request(app).post(`/v1/organizations/${owner.id}/change-request`).set(owner.h)).status).toBe(403);
    // The old owner can now leave.
    expect((await request(app).post(`/v1/memberships/${owner.mid}/leave`).set(owner.h)).status).toBe(200);
  });

  it("a target without an approved verification, an inactive or foreign member, or the owner itself is 409", async () => {
    const owner = await orgWithOwner(app);
    const admin = await opsUser(app, "ops_admin");
    const unverified = await addMember(app, owner.id, "ADMIN");
    const pending = await addMember(app, owner.id, "MANAGER", "UNDER_REVIEW");
    const other = await orgWithOwner(app);
    const foreign = await eligible(other.id);
    const cases = [
      [unverified.mid, "This member must complete verification first."],
      [pending.mid, "Pick an active member of this organization."],
      [foreign.mid, "Pick an active member of this organization."],
      [owner.mid, "Pick an active member of this organization."],
    ];
    for (const [mid, message] of cases) {
      const res = await transfer(admin.h, owner.id, { targetMembershipId: mid, reason: REASON });
      expect(res.status, message).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message });
    }
    expect(await owners(owner.id)).toEqual([{ id: owner.mid }]);
    expect((await transfer(admin.h, owner.id, { targetMembershipId: unverified.mid, reason: "short" })).status).toBe(400);
    expect((await transfer(admin.h, "00000000-0000-4000-8000-000000000000", { targetMembershipId: unverified.mid, reason: REASON })).status).toBe(404);
  });

  it("an approval on a past membership does not make the current one eligible", async () => {
    const owner = await orgWithOwner(app);
    const admin = await opsUser(app, "ops_admin");
    const old = await eligible(owner.id);
    await adminSql`UPDATE app.organization_memberships SET status = 'REVOKED' WHERE id = ${old.mid}`;
    const [again] = await adminSql<{ id: string }[]>`INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status, activated_at) VALUES (gen_random_uuid(), ${owner.id}, ${old.userId}, 'ADMIN', 'ACTIVE', now()) RETURNING id`;
    const res = await transfer(admin.h, owner.id, { targetMembershipId: again!.id, reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("This member must complete verification first.");
    const review = await request(app).get(`/v1/ops/organizations/${owner.id}`).set(admin.h);
    expect(review.body.members.find((m: { id: string }) => m.id === again!.id)).toMatchObject({ verificationApproved: false });
  });

  it("an ops_admin who belongs to the organization cannot transfer it", async () => {
    const owner = await orgWithOwner(app);
    const target = await eligible(owner.id);
    const insider = await addMember(app, owner.id, "VIEWER");
    await grantRole({ operator: "test", requestId: "grant" }, insider.userId, "ops_admin");
    const res = await transfer(insider.h, owner.id, { targetMembershipId: target.mid, reason: REASON });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("You can't review your own organization.");
  });

  it("concurrent transfers to one target: one wins, the other is 409, exactly one OWNER remains", async () => {
    const owner = await orgWithOwner(app);
    const target = await eligible(owner.id);
    const admin = await opsUser(app, "ops_admin");
    const body = { targetMembershipId: target.mid, reason: REASON };
    const results = await Promise.all([transfer(admin.h, owner.id, body), transfer(admin.h, owner.id, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await owners(owner.id)).toEqual([{ id: target.mid }]);
    expect(await adminSql`SELECT 1 FROM app.membership_events WHERE kind = 'ownership_transferred'`).toHaveLength(2);
  });

  it("concurrent transfers to different targets serialize: one OWNER at the end", async () => {
    const owner = await orgWithOwner(app);
    const a = await eligible(owner.id);
    const b = await eligible(owner.id);
    const admin = await opsUser(app, "ops_admin");
    const results = await Promise.all([a, b].map((t) => transfer(admin.h, owner.id, { targetMembershipId: t.mid, reason: REASON })));
    expect(results.every((r) => r.status === 204 || r.status === 409)).toBe(true);
    expect(results.some((r) => r.status === 204)).toBe(true);
    expect(await owners(owner.id)).toHaveLength(1);
  });
});
