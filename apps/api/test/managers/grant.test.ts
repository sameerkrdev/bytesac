import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { applicationEvents, auditEvents, managerApplications, userPermissions, users } from "@repo/db";
import { app } from "../../src/app";
import { disableAddress, suspendUser } from "../../src/services/ops";
import { challengeFor, signIn, webHeaders } from "../helpers/auth";
import { fakes } from "../helpers/fakes";
import { resetDb, testDb } from "../helpers/db";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets";
import { opsUser, seedApplication } from "./helpers";

const db = testDb.db;
beforeEach(resetDb);

const smartWallet = { address: "0x" + "cd".repeat(20), sign: () => "0x" + "22".repeat(96) + ERC6492_SUFFIX };

/** Moves a SCREENING application to SCREENING_APPROVED through the ops API. */
async function approve(reviewer: { h: Record<string, string> }, id: string) {
  const res = await request(app).post(`/v1/ops/applications/${id}/transition`).set(reviewer.h).send({ to: "SCREENING_APPROVED" });
  expect(res.status).toBe(200);
}
const permissionsOf = (userId: string) => db.select().from(userPermissions).where(eq(userPermissions.userId, userId));
const appRow = async (id: string) => (await db.select().from(managerApplications).where(eq(managerApplications.id, id)))[0]!;

describe("approval when the wallet owner already exists", () => {
  it("grants immediately, records the proof, and /me shows the permission", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const id = await seedApplication({ status: "SCREENING", walletChain: "arbitrum", walletAddress: w.address.toLowerCase() });
    await approve(reviewer, id);
    expect(await permissionsOf(s.userId)).toHaveLength(1);
    expect(await appRow(id)).toMatchObject({ userId: s.userId });
    expect((await appRow(id)).walletProvenAt).toBeTruthy();
    const events = await db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id));
    expect(events.map((e) => e.kind)).toContain("permission_granted");
    expect((await db.select().from(auditEvents)).some((a) => a.action === "permission.granted")).toBe(true);
    expect((await request(app).get("/v1/me").set(webHeaders(s.cookie))).body.permissions).toEqual(["create_manager_organization"]);
  });

  it("a disabled address or suspended user is never granted", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    const disabled = newEvmWallet();
    const d = await signIn(app, disabled, "base");
    await disableAddress({ chain: "base", address: disabled.address, reason: "test", operator: "t", requestId: "r1" });
    const a1 = await seedApplication({ status: "SCREENING", walletAddress: disabled.address.toLowerCase() });
    await approve(reviewer, a1);
    const sol = newSolanaWallet();
    const u = await signIn(app, sol, "solana");
    await suspendUser({ userId: u.userId, reason: "test", operator: "t", requestId: "r2" });
    const a2 = await seedApplication({ status: "SCREENING", walletChain: "solana", walletAddress: sol.address });
    await approve(reviewer, a2);
    expect(await permissionsOf(d.userId)).toHaveLength(0);
    expect(await permissionsOf(u.userId)).toHaveLength(0);
    expect((await appRow(a1)).walletProvenAt).toBeNull();
    expect((await signIn(app, disabled, "arbitrum")).res.status).toBe(403);
  });

  it("approval alone never creates a user", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    const before = (await db.select().from(users)).length;
    await approve(reviewer, await seedApplication({ status: "SCREENING" }));
    expect((await db.select().from(users)).length).toBe(before);
  });
});

describe("grant at sign-in after approval", () => {
  it("an EOA signing in on a different EVM chain is granted", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    const w = newEvmWallet();
    const id = await seedApplication({ status: "SCREENING", walletChain: "base", walletAddress: w.address.toLowerCase() });
    await approve(reviewer, id);
    expect((await appRow(id)).walletProvenAt).toBeNull();
    const s = await signIn(app, w, "arbitrum");
    expect(await permissionsOf(s.userId)).toHaveLength(1);
    expect((await appRow(id)).userId).toBe(s.userId);
  });

  it("Solana", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    const w = newSolanaWallet();
    const id = await seedApplication({ status: "SCREENING", walletChain: "solana", walletAddress: w.address });
    await approve(reviewer, id);
    const s = await signIn(app, w, "solana");
    expect(await permissionsOf(s.userId)).toHaveLength(1);
  });

  it("a smart wallet proves only the submitted chain: another chain does not grant, adding the submitted chain does", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    fakes.evm.behavior = "valid";
    const id = await seedApplication({ status: "SCREENING", walletChain: "base", walletAddress: smartWallet.address });
    await approve(reviewer, id);
    const s = await signIn(app, smartWallet, "arbitrum");
    expect(await permissionsOf(s.userId)).toHaveLength(0);
    const ch = await challengeFor(app, { purpose: "add_chain_account", chain: "base", address: smartWallet.address }, webHeaders(s.cookie));
    const added = await request(app).post("/v1/auth/verify").set(webHeaders(s.cookie))
      .send({ challengeId: ch.body.challengeId, signature: smartWallet.sign(), client: "web" });
    expect(added.status).toBe(200);
    expect(await permissionsOf(s.userId)).toHaveLength(1);
  });

  it("a smart wallet signing in on the submitted chain is granted", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    fakes.evm.behavior = "valid";
    const id = await seedApplication({ status: "SCREENING", walletChain: "base", walletAddress: smartWallet.address });
    await approve(reviewer, id);
    const s = await signIn(app, smartWallet, "base");
    expect(await permissionsOf(s.userId)).toHaveLength(1);
  });

  it("an application that is not approved, or already proven, grants nothing", async () => {
    const w = newEvmWallet();
    const id = await seedApplication({ status: "SCREENING", walletAddress: w.address.toLowerCase() });
    const s = await signIn(app, w, "base");
    expect(await permissionsOf(s.userId)).toHaveLength(0);
    expect((await appRow(id)).walletProvenAt).toBeNull();
  });

  it("concurrent approval and first sign-in yield exactly one permission row", async () => {
    const reviewer = await opsUser(app, "ops_reviewer");
    for (let i = 0; i < 6; i++) {
      const w = newEvmWallet();
      const id = await seedApplication({ status: "SCREENING", walletAddress: w.address.toLowerCase() });
      const [approved, signed] = await Promise.all([
        request(app).post(`/v1/ops/applications/${id}/transition`).set(reviewer.h).send({ to: "SCREENING_APPROVED" }),
        signIn(app, w, "base"),
      ]);
      expect(approved.status).toBe(200);
      expect(await permissionsOf(signed.userId)).toHaveLength(1);
      expect((await appRow(id)).userId).toBe(signed.userId);
    }
  });
});
