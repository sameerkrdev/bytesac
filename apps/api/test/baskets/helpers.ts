import { randomBytes } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app";
import { adminSql } from "../helpers/db";
import { addMember, orgWithOwner, type Actor, type Role } from "../members/helpers";

export type Headers = Record<string, string>;
export const FULL_FEES = { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 0 }, rebalance: { type: "percent", bps: 0 }, subscription: null };

/** A VERIFIED organization with its owner (verified email) and one member per role below OWNER. */
export async function basketOrg() {
  const owner = await orgWithOwner(app);
  const members = {} as Record<Exclude<Role, "OWNER">, Actor>;
  for (const role of ["ADMIN", "MANAGER", "ANALYST", "VIEWER"] as const) members[role] = await addMember(app, owner.id, role);
  return { owner, members };
}

/** An instrument inserted directly as ACTIVE with one ACTIVE deployment (the registry lifecycle is Spec 5's concern). */
export async function activeInstrument(creator: string, over: { assetType?: string; status?: string; deployment?: boolean; name?: string } = {}): Promise<string> {
  const [i] = await adminSql<{ id: string }[]>`
    INSERT INTO app.instruments (id, name, symbol, asset_type, status, created_by_user_id)
    VALUES (gen_random_uuid(), ${over.name ?? "Asset"}, ${"T" + randomBytes(3).toString("hex").toUpperCase()}, ${over.assetType ?? "CRYPTO"}, ${over.status ?? "ACTIVE"}, ${creator}) RETURNING id`;
  if (over.deployment !== false) {
    await adminSql`INSERT INTO app.instrument_deployments (id, instrument_id, chain, token_standard, address, decimals, verification, status)
      VALUES (gen_random_uuid(), ${i!.id}, 'ethereum', 'erc20', ${"0x" + randomBytes(20).toString("hex")}, 18, 'manual', 'ACTIVE')`;
  }
  return i!.id;
}

export const create = (h: Headers, orgId: string, body: object = { name: "Core Crypto", category: "thematic" }) => request(app).post(`/v1/organizations/${orgId}/baskets`).set(h).send(body);
export const getBasket = (h: Headers, bid: string) => request(app).get(`/v1/baskets/${bid}`).set(h);
export const save = (h: Headers, bid: string, body: object) => request(app).patch(`/v1/baskets/${bid}/draft`).set(h).send(body);
export const post = (h: Headers, path: string, body?: object) => request(app).post(path).set(h).send(body);

export async function createBasket(h: Headers, orgId: string, body?: object) {
  const res = await create(h, orgId, body);
  if (res.status !== 201) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; openVersion: { id: string; updatedAt: string } };
}

/** Saves `over` on the open version using its current `updatedAt` and returns the response body. */
export async function saveOpen(h: Headers, bid: string, over: object) {
  const cur = (await getBasket(h, bid)).body;
  const res = await save(h, bid, { expectedUpdatedAt: cur.openVersion.updatedAt, ...over });
  if (res.status !== 200) throw new Error(`save failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Content that passes validation with two assets, given the registry ids. */
export const validContent = (a: string, b: string) => ({
  shortDescription: "A short description", strategyRisks: "Prices can fall.", thesis: "Thesis", methodology: "Methodology", minimumInvestmentUsdc: "100",
  assets: [{ instrumentId: a, targetWeightBps: 6000 }, { instrumentId: b, targetWeightBps: 4000 }],
});

/** Forces the open version to `status` and, for `published`, makes it the basket's current version in an ACTIVE basket. */
export async function forceStatus(bid: string, status: "in_review" | "approved" | "published") {
  const [v] = await adminSql<{ id: string }[]>`UPDATE app.basket_versions SET status = ${status}, published_at = ${status === "published" ? adminSql`now()` : null} WHERE basket_id = ${bid} AND status IN ('draft', 'changes_required', 'in_review', 'approved') RETURNING id`;
  if (status === "published") await adminSql`UPDATE app.baskets SET status = 'ACTIVE', current_version_id = ${v!.id} WHERE id = ${bid}`;
  return v!.id;
}

export const basketRow = async (bid: string) => (await adminSql`SELECT * FROM app.baskets WHERE id = ${bid}`)[0]!;
export const assignmentsOf = (bid: string) => adminSql<{ id: string; role: string; status: string; permissions: string[]; end_reason: string | null; user_id: string }[]>`SELECT id, role, status, permissions, end_reason, user_id FROM app.basket_assignments WHERE basket_id = ${bid} ORDER BY created_at, id`;
export const eventKinds = async (bid: string) => (await adminSql<{ kind: string }[]>`SELECT kind FROM app.basket_events WHERE basket_id = ${bid} ORDER BY created_at, id`).map((e) => e.kind);
