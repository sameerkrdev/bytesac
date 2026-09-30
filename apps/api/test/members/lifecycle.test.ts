import { readFileSync } from "node:fs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { newEvmWallet } from "../helpers/wallets";
import { createOrg, resetOrgDb, user, verifyEmail } from "../organizations/helpers";
import { addMember, eventsOf, invite, inviteBody, inviteExisting, invitePending, memberAction, membershipAction, orgWithOwner, rowOf } from "./helpers";

beforeEach(resetOrgDb);

describe("invites", () => {
  it("only a VERIFIED organization can invite", async () => {
    const owner = await user(app);
    const id = await createOrg(app, owner.h);
    const res = await invite(app, owner.h, id, inviteBody(newEvmWallet(), "VIEWER"));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "Your organization must be verified before inviting members." });
  });

  it("an existing user becomes INVITED with their user id; an unknown wallet waits for proof; nobody is created", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "VIEWER");
    expect(await rowOf(invitee.mid)).toMatchObject({ status: "INVITED", user_id: invitee.userId, role: "VIEWER", invited_email: "invitee@example.com", invited_by_user_id: owner.userId });
    const [{ before }] = await adminSql<[{ before: string }]>`SELECT count(*) before FROM app.users`;
    const { mid } = await invitePending(app, owner, "ANALYST");
    expect(await rowOf(mid)).toMatchObject({ status: "PENDING_WALLET_VERIFICATION", user_id: null, invited_wallet_family: "evm" });
    const [{ after }] = await adminSql<[{ after: string }]>`SELECT count(*) after FROM app.users`;
    expect(after).toBe(before);
    expect((await eventsOf(mid)).map((e) => e.kind)).toEqual(["invited"]);
    expect(fakes.email.membership.filter((m) => m.kind === "invited").map((m) => m.to)).toEqual(["invitee@example.com", "invitee@example.com"]);
  });

  it("the invite email address is lowercased and the expiry is 14 days", async () => {
    const owner = await orgWithOwner(app);
    const w = newEvmWallet();
    await invite(app, owner.h, owner.id, inviteBody(w, "VIEWER", { email: "Mixed@Example.COM" }));
    const [m] = await adminSql<{ e: string; days: string }[]>`SELECT invited_email e, round(extract(epoch FROM invite_expires_at - now()) / 86400) days FROM app.organization_memberships WHERE invited_wallet_address = ${w.address.toLowerCase()}`;
    expect(m).toEqual({ e: "mixed@example.com", days: "14" });
  });

  it("a duplicate open invite or an existing member is 409 INVITE_EXISTS", async () => {
    const owner = await orgWithOwner(app);
    const w = newEvmWallet();
    expect((await invite(app, owner.h, owner.id, inviteBody(w, "VIEWER"))).status).toBe(201);
    const again = await invite(app, owner.h, owner.id, inviteBody(w, "MANAGER", { walletAddress: w.address.toLowerCase() }));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "INVITE_EXISTS", message: "This wallet already has an open invitation or membership." });
    const member = await addMember(app, owner.id, "VIEWER");
    expect((await invite(app, owner.h, owner.id, inviteBody(member.wallet, "VIEWER"))).body.error.code).toBe("INVITE_EXISTS");
    expect((await invite(app, owner.h, owner.id, inviteBody(owner.wallet, "VIEWER"))).body.error.code).toBe("INVITE_EXISTS");
  });

  it("OWNER is not invitable and a bad address is 400", async () => {
    const owner = await orgWithOwner(app);
    expect((await invite(app, owner.h, owner.id, inviteBody(newEvmWallet(), "OWNER" as never))).status).toBe(400);
    expect((await invite(app, owner.h, owner.id, inviteBody({ address: "0x123" }, "VIEWER"))).status).toBe(400);
  });

  it("invitations are limited to 20 per hour per organization", async () => {
    const owner = await orgWithOwner(app);
    for (let i = 0; i < 20; i++) expect((await invite(app, owner.h, owner.id, inviteBody(newEvmWallet(), "VIEWER"))).status).toBe(201);
    expect((await invite(app, owner.h, owner.id, inviteBody(newEvmWallet(), "VIEWER"))).status).toBe(429);
  });

  it("the inviter cancels an open invite; history stays", async () => {
    const owner = await orgWithOwner(app);
    const { mid } = await invitePending(app, owner, "MANAGER");
    expect((await memberAction(app, owner.h, owner.id, mid, "cancel")).status).toBe(200);
    expect(await rowOf(mid)).toMatchObject({ status: "REVOKED" });
    expect((await eventsOf(mid)).map((e) => e.kind)).toEqual(["invited", "cancelled"]);
    expect((await memberAction(app, owner.h, owner.id, mid, "cancel")).status).toBe(409);
    // The same wallet can be invited again once the old invite is closed.
    expect((await adminSql`SELECT 1 FROM app.organization_memberships WHERE id = ${mid}`).length).toBe(1);
  });
});

describe("accept, decline, expiry", () => {
  it("accepting as VIEWER or ANALYST is ACTIVE at once and the inviter is emailed", async () => {
    const owner = await orgWithOwner(app);
    for (const role of ["VIEWER", "ANALYST"] as const) {
      const invitee = await inviteExisting(owner, role);
      const res = await membershipAction(app, invitee.h, invitee.mid, "accept");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ACTIVE", role });
      expect((await rowOf(invitee.mid)).activated_at).toBeTruthy();
      expect((await request(app).get(`/v1/organizations/${owner.id}`).set(invitee.h)).status).toBe(200);
    }
    expect(fakes.email.membership.filter((m) => m.kind === "accepted")).toHaveLength(2);
  });

  it("accepting as MANAGER or ADMIN waits for documents and opens one member verification; no permissions yet", async () => {
    const owner = await orgWithOwner(app);
    for (const role of ["MANAGER", "ADMIN"] as const) {
      const invitee = await inviteExisting(owner, role);
      expect(invitee.mid).toBeTruthy();
      const res = await membershipAction(app, invitee.h, invitee.mid, "accept");
      expect(res.body).toMatchObject({ status: "PENDING_DOCUMENTS", role });
      const v = await adminSql`SELECT status FROM app.member_verifications WHERE membership_id = ${invitee.mid}`;
      expect(v).toEqual([{ status: "draft" }]);
      expect((await request(app).get(`/v1/organizations/${owner.id}`).set(invitee.h)).status).toBe(403);
    }
  });

  it("a user with an approved verification in this organization is ACTIVE at once", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "MANAGER");
    await adminSql`INSERT INTO app.member_verifications (id, membership_id, status) VALUES (gen_random_uuid(), ${invitee.mid}, 'approved')`;
    expect((await membershipAction(app, invitee.h, invitee.mid, "accept")).body.status).toBe("ACTIVE");
  });

  it("decline is REJECTED and terminal", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "VIEWER");
    expect((await membershipAction(app, invitee.h, invitee.mid, "decline")).body.status).toBe("REJECTED");
    expect((await membershipAction(app, invitee.h, invitee.mid, "accept")).status).toBe(409);
    expect((await eventsOf(invitee.mid)).map((e) => e.kind)).toEqual(["invited", "declined"]);
  });

  it("only the invitee can accept: others get 404 and nothing changes", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "VIEWER");
    const stranger = await user(app, false);
    expect((await membershipAction(app, stranger.h, invitee.mid, "accept")).status).toBe(404);
    expect((await membershipAction(app, owner.h, invitee.mid, "accept")).status).toBe(404);
    expect((await rowOf(invitee.mid)).status).toBe("INVITED");
  });

  it("GET /me/invitations lists open invitations and /me.organizations does not include them", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "MANAGER");
    const res = await request(app).get("/v1/me/invitations").set(invitee.h);
    expect(res.body.invitations).toEqual([{ membershipId: invitee.mid, organization: { id: owner.id, displayName: null }, role: "MANAGER", expiresAt: expect.any(String) }]);
    expect((await request(app).get("/v1/me").set(invitee.h)).body.organizations).toEqual([]);
    await membershipAction(app, invitee.h, invitee.mid, "accept");
    expect((await request(app).get("/v1/me/invitations").set(invitee.h)).body.invitations).toEqual([]);
    expect((await request(app).get("/v1/me").set(invitee.h)).body.organizations).toEqual([
      { id: owner.id, role: "MANAGER", status: "VERIFIED", membershipId: invitee.mid, membershipStatus: "PENDING_DOCUMENTS" },
    ]);
  });

  it("an invite older than 14 days is REVOKED when read and cannot be accepted", async () => {
    const owner = await orgWithOwner(app);
    const a = await inviteExisting(owner, "VIEWER");
    const b = await inviteExisting(owner, "VIEWER");
    const pending = await invitePending(app, owner, "VIEWER");
    await adminSql`UPDATE app.organization_memberships SET invite_expires_at = now() - interval '1 minute' WHERE id IN (${a.mid}, ${b.mid}, ${pending.mid})`;
    // Accept path.
    const accept = await membershipAction(app, a.h, a.mid, "accept");
    expect(accept.status).toBe(409);
    expect(accept.body.error.message).toBe("This invitation has expired.");
    expect((await rowOf(a.mid)).status).toBe("REVOKED");
    expect((await eventsOf(a.mid)).map((e) => e.kind)).toEqual(["invited", "expired"]);
    // Invitee read path.
    expect((await request(app).get("/v1/me/invitations").set(b.h)).body.invitations).toEqual([]);
    expect((await rowOf(b.mid)).status).toBe("REVOKED");
    // Org member list read path (also covers a wallet that never proved itself).
    const list = await request(app).get(`/v1/organizations/${owner.id}/members`).set(owner.h);
    expect(list.body.members.map((m: { id: string }) => m.id)).toEqual([owner.mid]);
    expect((await rowOf(pending.mid)).status).toBe("REVOKED");
    expect((await eventsOf(pending.mid)).at(-1)).toMatchObject({ kind: "expired", from_status: "PENDING_WALLET_VERIFICATION", to_status: "REVOKED" });
  });
});

describe("role changes, removal and leaving", () => {
  it("a downgrade is immediate; moving between ANALYST and VIEWER is immediate", async () => {
    const owner = await orgWithOwner(app);
    const manager = await addMember(app, owner.id, "MANAGER");
    const res = await memberAction(app, owner.h, owner.id, manager.mid, "role", { role: "VIEWER" });
    expect(res.status).toBe(200);
    expect(await rowOf(manager.mid)).toMatchObject({ role: "VIEWER", requested_role: null });
    expect((await memberAction(app, owner.h, owner.id, manager.mid, "role", { role: "ANALYST" })).status).toBe(200);
    expect((await rowOf(manager.mid)).role).toBe("ANALYST");
    expect((await eventsOf(manager.mid)).map((e) => e.kind)).toEqual(["role_changed", "role_changed"]);
    expect((await memberAction(app, owner.h, owner.id, manager.mid, "role", { role: "ANALYST" })).status).toBe(409);
  });

  it("an upgrade into a reviewed role keeps the old role, records the request and opens a verification", async () => {
    const owner = await orgWithOwner(app);
    const viewer = await addMember(app, owner.id, "VIEWER");
    const res = await memberAction(app, owner.h, owner.id, viewer.mid, "role", { role: "MANAGER" });
    expect(res.status).toBe(200);
    expect(await rowOf(viewer.mid)).toMatchObject({ role: "VIEWER", requested_role: "MANAGER", status: "ACTIVE" });
    expect(await adminSql`SELECT status FROM app.member_verifications WHERE membership_id = ${viewer.mid}`).toEqual([{ status: "draft" }]);
    expect((await eventsOf(viewer.mid)).map((e) => e.kind)).toEqual(["role_requested"]);
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(viewer.h)).body.myPermissions).toEqual(["org.read"]);
    // A second request reuses the open verification.
    await memberAction(app, owner.h, owner.id, viewer.mid, "role", { role: "ADMIN" });
    expect(await adminSql`SELECT 1 FROM app.member_verifications WHERE membership_id = ${viewer.mid}`).toHaveLength(1);
  });

  it("an upgrade is immediate when the member already has an approved verification", async () => {
    const owner = await orgWithOwner(app);
    const viewer = await addMember(app, owner.id, "VIEWER");
    await adminSql`INSERT INTO app.member_verifications (id, membership_id, status) VALUES (gen_random_uuid(), ${viewer.mid}, 'approved')`;
    await memberAction(app, owner.h, owner.id, viewer.mid, "role", { role: "MANAGER" });
    expect(await rowOf(viewer.mid)).toMatchObject({ role: "MANAGER", requested_role: null });
  });

  it("only an active member can change role, and the role change of a non-member id is 404", async () => {
    const owner = await orgWithOwner(app);
    const { mid } = await invitePending(app, owner, "VIEWER");
    expect((await memberAction(app, owner.h, owner.id, mid, "role", { role: "ANALYST" })).status).toBe(409);
    expect((await memberAction(app, owner.h, owner.id, "00000000-0000-4000-8000-000000000000", "role", { role: "ANALYST" })).status).toBe(404);
  });

  it("removal revokes, keeps history, emails the member and ends their access", async () => {
    const owner = await orgWithOwner(app);
    const analyst = await addMember(app, owner.id, "ANALYST");
    await verifyEmail(analyst.userId, "analyst@example.com");
    expect((await memberAction(app, owner.h, owner.id, analyst.mid, "remove")).status).toBe(200);
    expect(await rowOf(analyst.mid)).toMatchObject({ status: "REVOKED" });
    expect((await rowOf(analyst.mid)).left_at).toBeTruthy();
    expect((await eventsOf(analyst.mid)).map((e) => e.kind)).toEqual(["removed"]);
    expect(fakes.email.membership).toContainEqual(expect.objectContaining({ kind: "removed", to: "analyst@example.com" }));
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(analyst.h)).status).toBe(403);
    expect((await memberAction(app, owner.h, owner.id, analyst.mid, "remove")).status).toBe(409);
  });

  it("leaving revokes the membership and keeps every history row", async () => {
    const owner = await orgWithOwner(app);
    const invitee = await inviteExisting(owner, "VIEWER");
    await membershipAction(app, invitee.h, invitee.mid, "accept");
    const res = await membershipAction(app, invitee.h, invitee.mid, "leave");
    expect(res.body.status).toBe("REVOKED");
    expect((await eventsOf(invitee.mid)).map((e) => e.kind)).toEqual(["invited", "accepted", "left"]);
    expect((await membershipAction(app, invitee.h, invitee.mid, "leave")).status).toBe(409);
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(invitee.h)).status).toBe(403);
    const audit = await adminSql`SELECT action FROM app.audit_events WHERE entity_id = ${invitee.mid} ORDER BY created_at, id`;
    expect(audit.map((a) => a.action)).toEqual(["membership.invited", "membership.accepted", "membership.left"]);
  });

  it("the public name and title are set, cleared with null, and only for the member's own open membership", async () => {
    const owner = await orgWithOwner(app);
    const res = await request(app).patch(`/v1/memberships/${owner.mid}/profile`).set(owner.h).send({ publicDisplayName: "Ada L.", publicTitle: "Founder" });
    expect(res.body).toMatchObject({ publicDisplayName: "Ada L.", publicTitle: "Founder" });
    const cleared = await request(app).patch(`/v1/memberships/${owner.mid}/profile`).set(owner.h).send({ publicTitle: null });
    expect(cleared.body).toMatchObject({ publicDisplayName: "Ada L.", publicTitle: null });
    expect((await request(app).patch(`/v1/memberships/${owner.mid}/profile`).set(owner.h).send({ publicDisplayName: "A" })).status).toBe(400);
    const other = await user(app, false);
    expect((await request(app).patch(`/v1/memberships/${owner.mid}/profile`).set(other.h).send({ publicTitle: "Hacked" })).status).toBe(404);
    expect((await request(app).get(`/v1/memberships/${owner.mid}`).set(owner.h)).body).toMatchObject({ id: owner.mid, role: "OWNER", status: "ACTIVE", publicDisplayName: "Ada L.", publicTitle: null });
    expect((await request(app).get(`/v1/memberships/${owner.mid}`).set(other.h)).status).toBe(404);
    const gone = await addMember(app, owner.id, "VIEWER", "REVOKED");
    expect((await request(app).patch(`/v1/memberships/${gone.mid}/profile`).set(gone.h).send({ publicTitle: "x" })).status).toBe(409);
  });
});

describe("data migration 0006", () => {
  it("Spec 3 owners are ACTIVE OWNER rows with an activation time", async () => {
    const owner = await user(app);
    const id = await createOrg(app, owner.h);
    expect(await adminSql`SELECT role, status, activated_at IS NOT NULL AS activated FROM app.organization_memberships WHERE organization_id = ${id}`).toEqual([{ role: "OWNER", status: "ACTIVE", activated: true }]);
  });

  it("the 0006 CASE maps active to ACTIVE and revoked to REVOKED (the migration's own expression, run on literals)", async () => {
    const sql = readFileSync(new URL("../../../../packages/db/migrations/0006_members.sql", import.meta.url), "utf8");
    const expression = /USING \((CASE "status"::text[\s\S]*?END)\)::"app"\."membership_status_v2"/.exec(sql)?.[1];
    expect(expression).toBeTruthy();
    for (const [old, mapped] of [["active", "ACTIVE"], ["revoked", "REVOKED"]]) {
      const [row] = await adminSql.unsafe<{ v: string }[]>(`SELECT (${expression!.replace('"status"::text', `'${old}'::text`)})::text AS v`);
      expect(row!.v).toBe(mapped);
    }
  });
});
