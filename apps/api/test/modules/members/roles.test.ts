import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { listRolesResponseSchema } from "@repo/validator";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../../helpers/db";
import { activeInstrument, createBasket } from "../baskets/helpers";
import { resetOrgDb } from "../organizations/helpers";
import { addMember, orgWithOwner, rowOf } from "./helpers";

type H = Record<string, string>;
let owner: Awaited<ReturnType<typeof orgWithOwner>>;

const roles = (h: H) => request(app).get(`/v1/organizations/${owner.id}/roles`).set(h);
const createRole = (h: H, body: object) => request(app).post(`/v1/organizations/${owner.id}/roles`).set(h).send(body);
const updateRole = (h: H, rid: string, body: object) => request(app).patch(`/v1/organizations/${owner.id}/roles/${rid}`).set(h).send(body);
const archive = (h: H, rid: string) => request(app).post(`/v1/organizations/${owner.id}/roles/${rid}/archive`).set(h);
const assign = (h: H, mid: string, customRoleId: string | null) => request(app).put(`/v1/organizations/${owner.id}/members/${mid}/custom-role`).set(h).send({ customRoleId });
const earnings = (h: H) => request(app).get(`/v1/organizations/${owner.id}/earnings`).set(h);
const roleId = async (name: string) => listRolesResponseSchema.parse((await roles(owner.h)).body).custom.find((r) => r.name === name)!.id;

beforeEach(async () => {
  await resetOrgDb();
  await redis.flushdb();
  owner = await orgWithOwner(app);
});

describe("defining custom roles", () => {
  it("lets the owner create a role from a base role plus read grants, listed with built-ins, audited", async () => {
    const res = await createRole(owner.h, { name: "Analyst + earnings", description: "Reads fee income", baseRole: "ANALYST", permissions: ["org.read", "analytics.read", "earnings.read"] });
    expect(res.status).toBe(201);
    const body = listRolesResponseSchema.parse(res.body);
    expect(body.builtIn.map((b) => b.role)).toEqual(["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"]);
    expect(body.custom).toEqual([expect.objectContaining({ name: "Analyst + earnings", baseRole: "ANALYST", permissions: ["org.read", "analytics.read", "earnings.read"], memberCount: 0 })]);
    const [audit] = await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'organization_role.created'`;
    expect(audit).toBeDefined();
  });

  it("refuses owner-only and write permissions the base role doesn't have, duplicate names, and non-owners", async () => {
    expect((await createRole(owner.h, { name: "Payouts", baseRole: "ADMIN", permissions: ["org.read", "payout.manage"] })).status).toBe(400);
    expect((await createRole(owner.h, { name: "Viewer that edits", baseRole: "VIEWER", permissions: ["org.read", "baskets.manage"] })).status).toBe(400);
    expect((await createRole(owner.h, { name: "No read", baseRole: "VIEWER", permissions: ["analytics.read"] })).status).toBe(400);
    expect((await createRole(owner.h, { name: "Owner-ish", baseRole: "OWNER", permissions: ["org.read"] })).status).toBe(400);
    expect((await createRole(owner.h, { name: "Reader", baseRole: "VIEWER", permissions: ["org.read"] })).status).toBe(201);
    expect((await createRole(owner.h, { name: "reader", baseRole: "ANALYST", permissions: ["org.read"] })).body.error.code).toBe("ROLE_NAME_TAKEN");
    const admin = await addMember(app, owner.id, "ADMIN");
    expect((await createRole(admin.h, { name: "Mine", baseRole: "VIEWER", permissions: ["org.read"] })).status).toBe(403);
    const viewer = await addMember(app, owner.id, "VIEWER");
    expect((await roles(viewer.h)).status).toBe(200);
  });
});

describe("assigning custom roles", () => {
  it("grants exactly the role's permissions, server-side", async () => {
    const analyst = await addMember(app, owner.id, "ANALYST");
    expect((await earnings(analyst.h)).status).toBe(403);
    await createRole(owner.h, { name: "Finance reader", baseRole: "ANALYST", permissions: ["org.read", "earnings.read"] });
    const res = await assign(owner.h, analyst.mid, await roleId("Finance reader"));
    expect(res.status).toBe(200);
    const row = res.body.members.find((m: { id: string }) => m.id === analyst.mid);
    expect(row).toMatchObject({ customRole: { name: "Finance reader", applies: true }, permissions: ["org.read", "earnings.read"] });
    expect((await earnings(analyst.h)).status).toBe(200);
  });

  it("can narrow an admin (owner only) so it loses member management and basket-wide authority", async () => {
    const admin = await addMember(app, owner.id, "ADMIN");
    const other = await addMember(app, owner.id, "ADMIN");
    await createRole(owner.h, { name: "Admin (read-only team)", baseRole: "ADMIN", permissions: ["org.read", "analytics.read", "earnings.read"] });
    const rid = await roleId("Admin (read-only team)");
    expect((await assign(other.h, admin.mid, rid)).status).toBe(403); // only the owner changes what an admin can do
    expect((await assign(owner.h, admin.mid, rid)).status).toBe(200);
    expect((await request(app).post(`/v1/organizations/${owner.id}/members/invitations`).set(admin.h).send({ walletChain: "base", walletAddress: "0x" + "cd".repeat(20), role: "VIEWER", email: "a@example.com" })).status).toBe(403);
    await activeInstrument(owner.userId);
    const basket = await createBasket(owner.h, owner.id);
    expect((await request(app).patch(`/v1/baskets/${basket.id}/draft`).set(admin.h).send({ expectedRevision: basket.openVersion.revision, name: "Hijack" })).status).toBe(403);
    expect((await request(app).get(`/v1/baskets/${basket.id}`).set(admin.h)).body.myPermissions).toEqual([]);
  });

  it("only applies a role to its own base role, and a role change or archive falls back to built-in permissions", async () => {
    const analyst = await addMember(app, owner.id, "ANALYST");
    const viewer = await addMember(app, owner.id, "VIEWER");
    await createRole(owner.h, { name: "Finance reader", baseRole: "ANALYST", permissions: ["org.read", "earnings.read"] });
    const rid = await roleId("Finance reader");
    expect((await assign(owner.h, viewer.mid, rid)).body.error.code).toBe("INVALID_TRANSITION");
    expect((await assign(owner.h, owner.mid ?? "", rid)).status).toBeGreaterThanOrEqual(400);
    await assign(owner.h, analyst.mid, rid);
    // A role change clears the link.
    await request(app).post(`/v1/organizations/${owner.id}/members/${analyst.mid}/role`).set(owner.h).send({ role: "VIEWER" });
    expect((await rowOf(analyst.mid)).custom_role_id).toBeNull();
    expect((await earnings(analyst.h)).status).toBe(403);
    // Archiving releases holders.
    const second = await addMember(app, owner.id, "ANALYST");
    await assign(owner.h, second.mid, rid);
    expect((await earnings(second.h)).status).toBe(200);
    const archived = await archive(owner.h, rid);
    expect(archived.status).toBe(200);
    expect(archived.body.custom).toEqual([]);
    expect((await earnings(second.h)).status).toBe(403);
    expect((await rowOf(second.mid)).custom_role_id).toBeNull();
  });

  it("re-scoping a role applies at once and is validated against its base", async () => {
    const analyst = await addMember(app, owner.id, "ANALYST");
    await createRole(owner.h, { name: "Finance reader", baseRole: "ANALYST", permissions: ["org.read", "earnings.read"] });
    const rid = await roleId("Finance reader");
    await assign(owner.h, analyst.mid, rid);
    expect((await updateRole(owner.h, rid, { permissions: ["org.read", "baskets.manage"] })).status).toBe(400);
    expect((await updateRole(owner.h, rid, { name: "Reader", permissions: ["org.read"] })).status).toBe(200);
    expect((await earnings(analyst.h)).status).toBe(403);
    const [audit] = await adminSql<{ metadata: { from: string[]; to: string[] } }[]>`SELECT metadata FROM app.audit_events WHERE action = 'organization_role.updated'`;
    expect(audit!.metadata).toMatchObject({ from: ["org.read", "earnings.read"], to: ["org.read"] });
  });
});
