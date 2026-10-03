import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql } from "../helpers/db";
import { createOrg, ops, resetOrgDb, user, verifiedOrg } from "../organizations/helpers";
import { addMember } from "./helpers";

beforeEach(resetOrgDb);

const publicGet = (id: string) => request(app).get(`/v1/public/organizations/${id}`);

async function named(orgId: string, role: "OWNER" | "ADMIN" | "MANAGER" | "ANALYST" | "VIEWER", status: string, name: string | null, title: string | null = null, activated = status === "ACTIVE" || status === "REVOKED") {
  const m = await addMember(app, orgId, role, "INVITED");
  await adminSql`UPDATE app.organization_memberships SET status = ${status}, public_display_name = ${name}, public_title = ${title},
    activated_at = ${activated ? adminSql`now() - interval '30 days'` : null}, left_at = ${status === "REVOKED" && activated ? adminSql`now() - interval '1 day'` : null} WHERE id = ${m.mid}`;
  return m;
}

describe("public team", () => {
  it("lists opted-in ACTIVE members in role then name order and former members with dates, nothing private", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    await request(app).patch(`/v1/memberships/${(await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${o.id}`)[0]!.id}/profile`).set(o.h)
      .send({ publicDisplayName: "Ada Lovelace", publicTitle: "Founder" });
    await named(o.id, "VIEWER", "ACTIVE", "Zed Viewer");
    await named(o.id, "ADMIN", "ACTIVE", "Bea Admin", "COO");
    await named(o.id, "ADMIN", "ACTIVE", "Abe Admin");
    await named(o.id, "MANAGER", "ACTIVE", null);
    await named(o.id, "ANALYST", "INVITED", "Invited Person");
    await named(o.id, "MANAGER", "UNDER_REVIEW", "In Review");
    await named(o.id, "ANALYST", "REMOVAL_REQUESTED", "Removal Requested");
    await named(o.id, "MANAGER", "REVOKED", "Old Manager", "Head of trading");
    await named(o.id, "VIEWER", "REVOKED", "Never Active", null, false);
    await named(o.id, "ANALYST", "REJECTED", "Rejected Person");
    await named(o.id, "VIEWER", "REVOKED", null);

    const res = await publicGet(o.id);
    expect(res.status).toBe(200);
    expect(res.body.team.current).toEqual([
      { displayName: "Ada Lovelace", title: "Founder", role: "OWNER" },
      { displayName: "Abe Admin", title: null, role: "ADMIN" },
      { displayName: "Bea Admin", title: "COO", role: "ADMIN" },
      { displayName: "Zed Viewer", title: null, role: "VIEWER" },
    ]);
    expect(res.body.team.former).toEqual([{ displayName: "Old Manager", title: "Head of trading", role: "MANAGER", from: expect.any(String), to: expect.any(String) }]);
    const former = res.body.team.former[0];
    expect(new Date(former.from).getTime()).toBeLessThan(new Date(former.to).getTime());
    // Identifiers never leave: no user ids, wallets, emails or membership ids.
    const text = JSON.stringify(res.body);
    const rows = await adminSql<{ id: string; user_id: string | null; invited_email: string | null }[]>`SELECT id, user_id, invited_email FROM app.organization_memberships`;
    for (const r of rows) for (const secret of [r.id, r.user_id]) if (secret) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}|@example\.com|userId|walletAddress|invited/);
  });

  it("orders former members by end date, newest first", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    const older = await named(o.id, "MANAGER", "REVOKED", "Older");
    const newer = await named(o.id, "VIEWER", "REVOKED", "Newer");
    await adminSql`UPDATE app.organization_memberships SET left_at = now() - interval '10 days' WHERE id = ${older.mid}`;
    await adminSql`UPDATE app.organization_memberships SET left_at = now() - interval '2 days' WHERE id = ${newer.mid}`;
    expect((await publicGet(o.id)).body.team.former.map((f: { displayName: string }) => f.displayName)).toEqual(["Newer", "Older"]);
  });

  it("an organization without opted-in names has an empty team, and a non-VERIFIED organization is 404", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    expect((await publicGet(o.id)).body.team).toEqual({ current: [], former: [] });
    const u = await user(app);
    const draft = await createOrg(app, u.h);
    await request(app).patch(`/v1/memberships/${(await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${draft}`)[0]!.id}/profile`).set(u.h).send({ publicDisplayName: "Hidden Owner" });
    const res = await publicGet(draft);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Hidden Owner");
  });
});
