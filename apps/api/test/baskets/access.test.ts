import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { adminSql } from "../helpers/db";
import { addMember, type Actor } from "../members/helpers";
import { resetOrgDb, user } from "../organizations/helpers";
import { basketOrg, createBasket, forceStatus, getBasket, post, save, type Headers } from "./helpers";

type Who = "OWNER" | "ADMIN" | "lead" | "co-manager" | "co-manager without edit" | "MANAGER unassigned" | "ANALYST" | "VIEWER" | "outsider";
const WHO: Who[] = ["OWNER", "ADMIN", "lead", "co-manager", "co-manager without edit", "MANAGER unassigned", "ANALYST", "VIEWER", "outsider"];

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let actors: Record<Who, { h: Headers }>;
let co: Actor;
let coNoEdit: Actor;
let spare: Actor;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  const lead = await addMember(app, ctx.owner.id, "MANAGER");
  co = await addMember(app, ctx.owner.id, "MANAGER");
  coNoEdit = await addMember(app, ctx.owner.id, "MANAGER");
  spare = await addMember(app, ctx.owner.id, "MANAGER");
  actors = {
    OWNER: ctx.owner, ADMIN: ctx.members.ADMIN, lead, "co-manager": co, "co-manager without edit": coNoEdit, "MANAGER unassigned": ctx.members.MANAGER,
    ANALYST: ctx.members.ANALYST, VIEWER: ctx.members.VIEWER, outsider: await user(app, false),
  };
});

/** A basket led by `lead` with the two co-managers assigned (default flags; `submit` only). */
async function fresh() {
  await redis.flushdb(); // the lead would otherwise hit the 60/min mutation limit across this table
  const b = await createBasket(actors.lead.h, ctx.owner.id);
  expect((await post(actors.lead.h, `/v1/baskets/${b.id}/assignments`, { membershipId: co.mid, role: "co_manager" })).status).toBe(201);
  expect((await post(actors.lead.h, `/v1/baskets/${b.id}/assignments`, { membershipId: coNoEdit.mid, role: "co_manager", permissions: ["submit"] })).status).toBe(201);
  return b;
}

const READ: Who[] = WHO.filter((w) => w !== "outsider");
const EDIT: Who[] = ["OWNER", "ADMIN", "lead", "co-manager"];
const ASSIGN: Who[] = ["OWNER", "ADMIN", "lead"];
const expected = (allowed: Who[], ok: number, who: Who) => (allowed.includes(who) ? ok : 403);

describe("manager routes by role (server-side, per assignment flags)", () => {
  describe("reads", () => {
    let bid: string;
    beforeAll(async () => { bid = (await fresh()).id; });
    it.each(WHO)("GET basket: %s", async (who) => {
      expect((await getBasket(actors[who].h, bid)).status).toBe(expected(READ, 200, who));
    });
    it.each(WHO)("POST validate: %s", async (who) => {
      expect((await post(actors[who].h, `/v1/baskets/${bid}/validate`)).status).toBe(expected(READ, 200, who));
    });
    it.each(WHO)("GET versions: %s", async (who) => {
      expect((await request(app).get(`/v1/baskets/${bid}/versions`).set(actors[who].h)).status).toBe(expected(READ, 200, who));
    });
    it("shows each caller their own flags", async () => {
      const flags = async (who: Who) => (await getBasket(actors[who].h, bid)).body.myPermissions;
      expect(await flags("OWNER")).toHaveLength(5);
      expect(await flags("lead")).toHaveLength(5);
      expect(await flags("co-manager")).toEqual(["edit", "submit"]);
      expect(await flags("co-manager without edit")).toEqual(["submit"]);
      expect(await flags("MANAGER unassigned")).toEqual([]);
      expect(await flags("VIEWER")).toEqual([]);
    });
  });

  it.each(WHO)("PATCH draft: %s", async (who) => {
    const b = await fresh();
    const res = await save(actors[who].h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: `by ${who}` });
    expect(res.status).toBe(expected(EDIT, 200, who));
    const [v] = await adminSql<{ thesis: string | null }[]>`SELECT thesis FROM app.basket_versions WHERE id = ${b.openVersion.id}`;
    expect(v!.thesis).toBe(EDIT.includes(who) ? `by ${who}` : null);
  });

  it.each(WHO)("POST versions: %s", async (who) => {
    const b = await fresh();
    await forceStatus(b.id, "published");
    const res = await post(actors[who].h, `/v1/baskets/${b.id}/versions`);
    expect(res.status).toBe(expected(EDIT, 201, who));
    const [n] = await adminSql<{ n: number }[]>`SELECT count(*)::int AS n FROM app.basket_versions WHERE basket_id = ${b.id}`;
    expect(n!.n).toBe(EDIT.includes(who) ? 2 : 1);
  });

  it.each(WHO)("POST assignments: %s", async (who) => {
    const b = await fresh();
    const res = await post(actors[who].h, `/v1/baskets/${b.id}/assignments`, { membershipId: spare.mid, role: "co_manager" });
    expect(res.status).toBe(expected(ASSIGN, 201, who));
    const [n] = await adminSql<{ n: number }[]>`SELECT count(*)::int AS n FROM app.basket_assignments WHERE basket_id = ${b.id}`;
    expect(n!.n).toBe(ASSIGN.includes(who) ? 4 : 3);
  });

  it("a co-manager granted `assign` may assign; one without it may not", async () => {
    const b = await fresh();
    const detail = (await getBasket(actors.lead.h, b.id)).body;
    const coAssignment = detail.assignments.find((a: { membershipId: string }) => a.membershipId === co.mid);
    const patched = await request(app).patch(`/v1/baskets/${b.id}/assignments/${coAssignment.id}`).set(actors.lead.h).send({ permissions: ["edit", "submit", "assign"] });
    expect(patched.status).toBe(200);
    expect((await post(co.h, `/v1/baskets/${b.id}/assignments`, { membershipId: spare.mid, role: "co_manager" })).status).toBe(201);
    expect((await post(coNoEdit.h, `/v1/baskets/${b.id}/assignments`, { membershipId: ctx.members.MANAGER.mid, role: "co_manager" })).status).toBe(403);
  });

  it("an assignment does not survive the member losing baskets.manage (crafted request after a downgrade)", async () => {
    const b = await fresh();
    await adminSql`UPDATE app.organization_memberships SET role = 'ANALYST' WHERE id = ${co.mid}`;
    const res = await save(co.h, b.id, { expectedUpdatedAt: b.openVersion.updatedAt, thesis: "x" });
    expect(res.status).toBe(403);
    await adminSql`UPDATE app.organization_memberships SET role = 'MANAGER' WHERE id = ${co.mid}`;
  });
});
