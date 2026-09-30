import request from "supertest";
import type { Express } from "express";
import { adminSql } from "../helpers/db";
import { newEvmWallet } from "../helpers/wallets";
import { createOrg, user, verifyEmail } from "../organizations/helpers";

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "ANALYST" | "VIEWER";
export interface Actor { userId: string; h: Record<string, string>; wallet: ReturnType<typeof newEvmWallet>; mid: string }

/** An organization forced to VERIFIED (invites need it) with its owner; the owner has a verified email. */
export async function orgWithOwner(app: Express) {
  const owner = await user(app);
  await verifyEmail(owner.userId);
  const id = await createOrg(app, owner.h);
  await adminSql`UPDATE app.organizations SET status = 'VERIFIED' WHERE id = ${id}`;
  const [m] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${id}`;
  return { ...owner, id, mid: m!.id };
}

/** A signed-in user holding a membership in `orgId`, inserted directly (the lifecycle itself is tested through the API). */
export async function addMember(app: Express, orgId: string, role: Role, status = "ACTIVE"): Promise<Actor> {
  const u = await user(app, false);
  const [m] = await adminSql<{ id: string }[]>`
    INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status, activated_at)
    VALUES (gen_random_uuid(), ${orgId}, ${u.userId}, ${role}, ${status}, ${status === "ACTIVE" ? adminSql`now()` : null}) RETURNING id`;
  return { userId: u.userId, h: u.h, wallet: u.wallet, mid: m!.id };
}

export const inviteBody = (wallet: { address: string }, role: Role, over: Record<string, unknown> = {}) => ({ walletChain: "base", walletAddress: wallet.address, role, email: "invitee@example.com", ...over });
export const invite = (app: Express, h: Record<string, string>, orgId: string, body: object) => request(app).post(`/v1/organizations/${orgId}/members/invitations`).set(h).send(body);
export const memberAction = (app: Express, h: Record<string, string>, orgId: string, mid: string, action: string, body?: object) =>
  request(app).post(`/v1/organizations/${orgId}/members/${mid}/${action}`).set(h).send(body);
export const membershipAction = (app: Express, h: Record<string, string>, mid: string, action: string) => request(app).post(`/v1/memberships/${mid}/${action}`).set(h);

/** Invites a fresh wallet as `role` and returns the new membership id (the wallet is unknown to the platform: PENDING_WALLET_VERIFICATION). */
export async function invitePending(app: Express, owner: { h: Record<string, string>; id: string }, role: Role, wallet = newEvmWallet()) {
  const res = await invite(app, owner.h, owner.id, inviteBody(wallet, role));
  if (res.status !== 201) throw new Error(`invite failed: ${JSON.stringify(res.body)}`);
  const [m] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE organization_id = ${owner.id} AND invited_wallet_address = ${wallet.address.toLowerCase()} ORDER BY joined_at DESC`;
  return { mid: m!.id, wallet };
}

export const rowOf = async (mid: string) => (await adminSql`SELECT * FROM app.organization_memberships WHERE id = ${mid}`)[0]!;
export const eventsOf = async (mid: string) => (await adminSql<{ kind: string; from_status: string | null; to_status: string | null; reason: string | null }[]>`SELECT kind, from_status, to_status, reason FROM app.membership_events WHERE membership_id = ${mid} ORDER BY created_at, id`);

/** Resolves once `n` backends wait on a lock, so an overlap is certain rather than timing-dependent. */
export async function untilBlockedOnLock(n = 1): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const rows = await adminSql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (rows.length >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`fewer than ${n} transactions are waiting on a lock`);
}
