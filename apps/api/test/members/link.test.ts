import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { disableAddress, suspendUser } from "@/services/ops";
import { challengeFor, signIn, webHeaders } from "../helpers/auth";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets";
import { resetOrgDb } from "../organizations/helpers";
import { addMember, eventsOf, invite, inviteBody, invitePending, memberAction, orgWithOwner, rowOf, untilBlockedOnLock } from "./helpers";

beforeEach(resetOrgDb);

const smartWallet = { address: "0x" + "cd".repeat(20), sign: () => "0x" + "22".repeat(96) + ERC6492_SUFFIX };

describe("an invite waits for the wallet proof", () => {
  it("an EOA signing in on another EVM chain links the invite and /me/invitations shows it", async () => {
    const owner = await orgWithOwner(app);
    const { mid, wallet } = await invitePending(app, owner, "VIEWER");
    const s = await signIn(app, wallet, "arbitrum");
    expect(await rowOf(mid)).toMatchObject({ status: "INVITED", user_id: s.userId });
    expect((await eventsOf(mid)).map((e) => e.kind)).toEqual(["invited", "linked"]);
    const res = await request(app).get("/v1/me/invitations").set(webHeaders(s.cookie));
    expect(res.body.invitations.map((i: { membershipId: string }) => i.membershipId)).toEqual([mid]);
    expect((await adminSql`SELECT action FROM app.audit_events WHERE entity_id = ${mid} AND action = 'membership.linked'`)).toHaveLength(1);
  });

  it("Solana", async () => {
    const owner = await orgWithOwner(app);
    const wallet = newSolanaWallet();
    const res = await invite(app, owner.h, owner.id, inviteBody(wallet, "ANALYST", { walletChain: "solana" }));
    expect(res.status).toBe(201);
    const [m] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE invited_wallet_address = ${wallet.address}`;
    expect((await rowOf(m!.id)).status).toBe("PENDING_WALLET_VERIFICATION");
    const s = await signIn(app, wallet, "solana");
    expect(await rowOf(m!.id)).toMatchObject({ status: "INVITED", user_id: s.userId });
  });

  it("a smart wallet links only on the invited chain", async () => {
    const owner = await orgWithOwner(app);
    fakes.evm.behavior = "valid";
    expect((await invite(app, owner.h, owner.id, inviteBody(smartWallet, "VIEWER"))).status).toBe(201);
    const [m] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_memberships WHERE invited_wallet_address = ${smartWallet.address}`;
    const s = await signIn(app, smartWallet, "arbitrum");
    expect((await rowOf(m!.id)).status).toBe("PENDING_WALLET_VERIFICATION");
    const ch = await challengeFor(app, { purpose: "add_chain_account", chain: "base", address: smartWallet.address }, webHeaders(s.cookie));
    const added = await request(app).post("/v1/auth/verify").set(webHeaders(s.cookie)).send({ challengeId: ch.body.challengeId, signature: smartWallet.sign(), client: "web" });
    expect(added.status).toBe(200);
    expect(await rowOf(m!.id)).toMatchObject({ status: "INVITED", user_id: s.userId });
  });

  it("an unrelated sign-in links nothing and a typed address alone never links or creates anyone", async () => {
    const owner = await orgWithOwner(app);
    const { mid } = await invitePending(app, owner, "VIEWER");
    await signIn(app, newEvmWallet(), "base");
    await signIn(app, newSolanaWallet(), "solana");
    expect(await rowOf(mid)).toMatchObject({ status: "PENDING_WALLET_VERIFICATION", user_id: null });
  });

  it("an invite past its 14 days does not link", async () => {
    const owner = await orgWithOwner(app);
    const { mid, wallet } = await invitePending(app, owner, "VIEWER");
    await adminSql`UPDATE app.organization_memberships SET invite_expires_at = now() - interval '1 second' WHERE id = ${mid}`;
    await signIn(app, wallet, "base");
    expect(await rowOf(mid)).toMatchObject({ status: "PENDING_WALLET_VERIFICATION", user_id: null });
  });

  it("a disabled address or a suspended user never links", async () => {
    const owner = await orgWithOwner(app);
    const disabled = newEvmWallet();
    const d = await signIn(app, disabled, "base");
    await disableAddress({ chain: "base", address: disabled.address, reason: "test", operator: "t", requestId: "r1" });
    const sol = newSolanaWallet();
    const u = await signIn(app, sol, "solana");
    await suspendUser({ userId: u.userId, reason: "test", operator: "t", requestId: "r2" });

    const a = await invite(app, owner.h, owner.id, inviteBody(disabled, "VIEWER"));
    const b = await invite(app, owner.h, owner.id, inviteBody(sol, "VIEWER", { walletChain: "solana" }));
    expect([a.status, b.status]).toEqual([201, 201]);
    const rows = await adminSql<{ status: string; user_id: string | null }[]>`SELECT status, user_id FROM app.organization_memberships WHERE role = 'VIEWER'`;
    expect(rows).toEqual([{ status: "PENDING_WALLET_VERIFICATION", user_id: null }, { status: "PENDING_WALLET_VERIFICATION", user_id: null }]);
    expect((await signIn(app, disabled, "arbitrum")).res.status).toBe(403);
    expect((await signIn(app, sol, "solana")).res.status).toBe(401);
    expect(await adminSql`SELECT 1 FROM app.organization_memberships WHERE status <> 'PENDING_WALLET_VERIFICATION' AND role = 'VIEWER'`).toHaveLength(0);
    expect(d.userId).toBeTruthy();
  });

  it("a user who is already a member gets the pending duplicate invite revoked", async () => {
    const owner = await orgWithOwner(app);
    const member = await addMember(app, owner.id, "ANALYST");
    const [m] = await adminSql<{ id: string }[]>`
      INSERT INTO app.organization_memberships (id, organization_id, role, status, invited_wallet_chain, invited_wallet_family, invited_wallet_address, invited_email, invited_by_user_id, invite_expires_at)
      VALUES (gen_random_uuid(), ${owner.id}, 'VIEWER', 'PENDING_WALLET_VERIFICATION', 'base', 'evm', ${member.wallet.address.toLowerCase()}, 'dup@example.com', ${owner.userId}, now() + interval '14 days') RETURNING id`;
    await signIn(app, member.wallet, "arbitrum");
    expect(await rowOf(m!.id)).toMatchObject({ status: "REVOKED", user_id: null });
    expect((await eventsOf(m!.id)).at(-1)).toMatchObject({ kind: "cancelled", reason: "duplicate", to_status: "REVOKED" });
    expect((await rowOf(member.mid)).status).toBe("ACTIVE");
  });
});

describe("the wallet proof and the inviter's cancel overlap", () => {
  it("both take the membership lock: exactly one consistent outcome, REVOKED in the end", async () => {
    const owner = await orgWithOwner(app);
    const { mid, wallet } = await invitePending(app, owner, "VIEWER");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let holding!: () => void;
    const held = new Promise<void>((r) => { holding = r; });
    // A transaction holds the invite row while the sign-in hook and the cancel both queue for it.
    const holder = adminSql.begin(async (q) => {
      await q`SELECT 1 FROM app.organization_memberships WHERE id = ${mid} FOR UPDATE`;
      holding();
      await gate;
    });
    await held;
    const signedIn = signIn(app, wallet, "arbitrum");
    const cancelled = memberAction(app, owner.h, owner.id, mid, "cancel").then((r) => r);
    await untilBlockedOnLock(2);
    release();
    await holder;
    expect((await signedIn).res.status).toBe(200);
    expect((await cancelled).status).toBe(200);
    const row = await rowOf(mid);
    const kinds = (await eventsOf(mid)).map((e) => e.kind);
    expect(row.status).toBe("REVOKED");
    // Either the proof linked first (INVITED, then cancelled) or the cancel won and nothing linked.
    if (kinds.includes("linked")) expect(kinds).toEqual(["invited", "linked", "cancelled"]);
    else {
      expect(kinds).toEqual(["invited", "cancelled"]);
      expect(row.user_id).toBeNull();
    }
    expect(kinds.filter((k) => k === "cancelled")).toHaveLength(1);
  });
});
