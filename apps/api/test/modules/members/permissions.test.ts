import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type OrganizationPermission } from "@repo/validator";
import { app } from "@/app";
import { adminSql } from "../../helpers/db";
import { newEvmWallet } from "../../helpers/wallets";
import { resetOrgDb } from "../organizations/helpers";
import { addMember, invite, inviteBody, memberAction, membershipAction, orgWithOwner, rowOf, type Actor, type Role } from "./helpers";

const ROLES: Role[] = ["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"];
const ZERO = "00000000-0000-4000-8000-000000000000";

let orgId: string;
let actors: Record<Role, Actor>;
let target: Actor;

beforeAll(async () => {
  await resetOrgDb();
  const owner = await orgWithOwner(app);
  orgId = owner.id;
  actors = { OWNER: { userId: owner.userId, h: owner.h, wallet: owner.wallet, mid: owner.mid } } as Record<Role, Actor>;
  for (const role of ROLES.slice(1)) actors[role] = await addMember(app, orgId, role);
  target = await addMember(app, orgId, "VIEWER");
});

interface Route { name: string; permission: OrganizationPermission; call: (a: Actor) => request.Test }
const as = (t: request.Test, a: Actor) => t.set(a.h);
const routes: Route[] = [
  { name: "GET org", permission: "org.read", call: (a) => as(request(app).get(`/v1/organizations/${orgId}`), a) },
  { name: "GET members", permission: "org.read", call: (a) => as(request(app).get(`/v1/organizations/${orgId}/members`), a) },
  { name: "PATCH draft", permission: "org.edit", call: (a) => as(request(app).patch(`/v1/organizations/${orgId}/draft`), a).send({ publicProfile: { displayName: "Edited" } }) },
  { name: "presign document", permission: "org.edit", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/documents`), a).send({ documentType: "government_id", contentType: "application/pdf", sizeBytes: 10 }) },
  { name: "confirm document", permission: "org.edit", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/documents/${ZERO}/confirm`), a) },
  { name: "unlink document", permission: "org.edit", call: (a) => as(request(app).delete(`/v1/organizations/${orgId}/draft/documents/${ZERO}`), a) },
  { name: "submit", permission: "org.edit", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/submit`), a) },
  { name: "change request", permission: "org.edit", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/change-request`), a) },
  { name: "submit change request", permission: "org.edit", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/change-request/submit`), a) },
  { name: "enter payout wallet", permission: "payout.manage", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/payout-wallet`), a).send({ address: "11111111111111111111111111111111" }) },
  { name: "payout challenge", permission: "payout.manage", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/payout-wallet/challenge`), a) },
  { name: "verify payout wallet", permission: "payout.manage", call: (a) => as(request(app).post(`/v1/organizations/${orgId}/payout-wallet/verify`), a).send({ challengeId: ZERO, signature: "x" }) },
  { name: "invite VIEWER", permission: "members.manage", call: (a) => invite(app, a.h, orgId, inviteBody(newEvmWallet(), "VIEWER")) },
  { name: "invite ADMIN", permission: "members.manage_admins", call: (a) => invite(app, a.h, orgId, inviteBody(newEvmWallet(), "ADMIN")) },
  { name: "cancel invite", permission: "members.manage", call: (a) => memberAction(app, a.h, orgId, target.mid, "cancel") },
  { name: "change role", permission: "members.manage", call: (a) => memberAction(app, a.h, orgId, target.mid, "role", { role: "ANALYST" }) },
  { name: "remove member", permission: "members.manage", call: (a) => memberAction(app, a.h, orgId, ZERO, "remove") },
  { name: "confirm removal", permission: "members.manage_admins", call: (a) => memberAction(app, a.h, orgId, target.mid, "removal/confirm") },
  { name: "cancel removal", permission: "members.manage_admins", call: (a) => memberAction(app, a.h, orgId, target.mid, "removal/cancel") },
];

describe("every organization route honors the role matrix", () => {
  // Allowed means the permission check passed (the request may still fail on state, e.g. 404/409); denied is exactly 403 FORBIDDEN.
  for (const route of routes) {
    for (const role of ROLES) {
      const allowed = ROLE_PERMISSIONS[role].includes(route.permission);
      it(`${route.name}: ${role} is ${allowed ? "allowed" : "denied"}`, async () => {
        const res = await route.call(actors[role]);
        if (allowed) expect(res.status, JSON.stringify(res.body)).not.toBe(403);
        else {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe("FORBIDDEN");
        }
      });
    }
  }

  it("a non-member is denied everywhere and an unknown organization is 404", async () => {
    const outsider = await addMember(app, orgId, "VIEWER", "REVOKED");
    expect((await request(app).get(`/v1/organizations/${orgId}`).set(outsider.h)).status).toBe(403);
    expect((await request(app).get(`/v1/organizations/${orgId}/members`).set(outsider.h)).status).toBe(403);
    expect((await request(app).get(`/v1/organizations/${ZERO}`).set(outsider.h)).status).toBe(404);
  });

  it("only ACTIVE memberships grant permissions", async () => {
    for (const status of ["INVITED", "PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "REMOVAL_REQUESTED"]) {
      const m = await addMember(app, orgId, "ADMIN", status);
      expect((await request(app).get(`/v1/organizations/${orgId}`).set(m.h)).status, status).toBe(403);
    }
  });

  it("the organization detail reports the caller's role and permissions, private details included", async () => {
    const res = await request(app).get(`/v1/organizations/${orgId}`).set(actors.ANALYST.h);
    expect(res.body.myRole).toBe("ANALYST");
    expect(res.body.myPermissions).toEqual(["org.read", "analytics.read"]);
    expect(res.body.openVersion.privateDetails).toBeDefined();
  });

  it("the member list hides invite wallets and emails from roles without members.manage", async () => {
    await invite(app, actors.OWNER.h, orgId, inviteBody(newEvmWallet(), "VIEWER"));
    const owner = await request(app).get(`/v1/organizations/${orgId}/members`).set(actors.OWNER.h);
    expect(owner.body.members.some((m: { invitedWallet: unknown }) => m.invitedWallet !== null)).toBe(true);
    const viewer = await request(app).get(`/v1/organizations/${orgId}/members`).set(actors.VIEWER.h);
    expect(viewer.body.members.length).toBeGreaterThan(1);
    for (const m of viewer.body.members) expect(m).toMatchObject({ invitedWallet: null, invitedEmail: null, verificationStatus: null });
  });
});

describe("crafted requests against the OWNER and other ADMINs change nothing", () => {
  it("ADMIN cannot demote, remove, cancel or invite an ADMIN or touch the OWNER", async () => {
    const admin = actors.ADMIN;
    const otherAdmin = await addMember(app, orgId, "ADMIN");
    expect((await invite(app, admin.h, orgId, inviteBody(newEvmWallet(), "ADMIN"))).status).toBe(403);
    expect((await memberAction(app, admin.h, orgId, otherAdmin.mid, "role", { role: "VIEWER" })).status).toBe(403);
    expect((await memberAction(app, admin.h, orgId, actors.OWNER.mid, "role", { role: "VIEWER" })).status).toBe(403);
    expect((await memberAction(app, admin.h, orgId, actors.OWNER.mid, "remove")).status).toBe(403);
    expect((await memberAction(app, admin.h, orgId, actors.OWNER.mid, "cancel")).status).toBe(403);
    expect((await memberAction(app, admin.h, orgId, target.mid, "role", { role: "ADMIN" })).status).toBe(403);
    expect(await rowOf(otherAdmin.mid)).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
    expect(await rowOf(actors.OWNER.mid)).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect((await rowOf(target.mid)).role).not.toBe("ADMIN");
  });

  it("an ADMIN cannot cancel or replace the OWNER's pending ADMIN promotion", async () => {
    const viewer = await addMember(app, orgId, "VIEWER");
    await memberAction(app, actors.OWNER.h, orgId, viewer.mid, "role", { role: "ADMIN" });
    expect(await rowOf(viewer.mid)).toMatchObject({ role: "VIEWER", requested_role: "ADMIN" });
    expect((await memberAction(app, actors.ADMIN.h, orgId, viewer.mid, "role", { role: "ANALYST" })).status).toBe(403);
    expect(await rowOf(viewer.mid)).toMatchObject({ role: "VIEWER", requested_role: "ADMIN" });
  });

  it("ADMIN removing an ADMIN only requests the removal; the OWNER confirms or cancels", async () => {
    const victim = await addMember(app, orgId, "ADMIN");
    const requested = await memberAction(app, actors.ADMIN.h, orgId, victim.mid, "remove");
    expect(requested.status).toBe(200);
    expect(await rowOf(victim.mid)).toMatchObject({ status: "REMOVAL_REQUESTED", removal_requested_by_user_id: actors.ADMIN.userId });
    // The requested ADMIN has no permissions meanwhile; the requesting ADMIN cannot confirm.
    expect((await request(app).get(`/v1/organizations/${orgId}`).set(victim.h)).status).toBe(403);
    expect((await memberAction(app, actors.ADMIN.h, orgId, victim.mid, "removal/confirm")).status).toBe(403);
    expect((await memberAction(app, actors.OWNER.h, orgId, victim.mid, "removal/cancel")).status).toBe(200);
    expect(await rowOf(victim.mid)).toMatchObject({ status: "ACTIVE", removal_requested_by_user_id: null });
    expect((await memberAction(app, actors.ADMIN.h, orgId, victim.mid, "remove")).status).toBe(200);
    expect((await memberAction(app, actors.OWNER.h, orgId, victim.mid, "removal/confirm")).status).toBe(200);
    expect(await rowOf(victim.mid)).toMatchObject({ status: "REVOKED" });
    expect((await request(app).get(`/v1/organizations/${orgId}`).set(victim.h)).status).toBe(403);
  });

  it("the OWNER cannot be removed, demoted or leave (409) and stays the one OWNER", async () => {
    const owner = actors.OWNER;
    const removed = await memberAction(app, owner.h, orgId, owner.mid, "remove");
    expect(removed.status).toBe(409);
    expect(removed.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "Contact support to transfer ownership first." });
    expect((await memberAction(app, owner.h, orgId, owner.mid, "role", { role: "ADMIN" })).status).toBe(409);
    expect((await membershipAction(app, owner.h, owner.mid, "leave")).status).toBe(409);
    expect(await rowOf(owner.mid)).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    const [{ n }] = await adminSql<[{ n: string }]>`SELECT count(*) n FROM app.organization_memberships WHERE organization_id = ${orgId} AND role = 'OWNER' AND status = 'ACTIVE'`;
    expect(Number(n)).toBe(1);
  });

  it("the database refuses a second active OWNER", async () => {
    await expect(adminSql`UPDATE app.organization_memberships SET role = 'OWNER' WHERE id = ${actors.MANAGER.mid}`).rejects.toThrow();
  });

  it("a member of another organization cannot reach this one's members", async () => {
    const other = await orgWithOwner(app);
    expect((await request(app).get(`/v1/organizations/${orgId}/members`).set(other.h)).status).toBe(403);
    expect((await memberAction(app, other.h, other.id, actors.VIEWER.mid, "remove")).status).toBe(404);
  });
});
