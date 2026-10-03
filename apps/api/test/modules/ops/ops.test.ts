import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, walletAddresses } from "@repo/db";
import { disableAddress, reactivateAddress, suspendUser } from "@/modules/ops/ops.service";
import { app } from "@/app";
import { signIn } from "../../helpers/auth";
import { resetDb, testDb } from "../../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

describe("ops", () => {
  it("disable blocks sign-in on every chain, revokes sessions, blocks linking by others; reactivate restores", async () => {
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    const out = await disableAddress({ chain: "ethereum", address: w.address, reason: "reported compromised", operator: "ops@bytesac", requestId: "ops-1" });
    expect(out).toEqual({ disabledRows: 4, revokedSessions: 1 });
    expect((await request(app).get("/v1/me").set("Cookie", s.cookie!)).status).toBe(401);
    expect((await signIn(app, w, "arbitrum")).res.body.error.code).toBe("ADDRESS_DISABLED");
    expect((await db.select().from(walletAddresses)).every((a) => a.status === "disabled" && a.disabledReason === "reported compromised")).toBe(true);
    expect(await reactivateAddress({ chain: "base", address: w.address, operator: "ops@bytesac", requestId: "ops-2" })).toBe(4);
    expect((await signIn(app, w, "base")).res.status).toBe(200);
    const actions = (await db.select().from(auditEvents)).filter((a) => a.actorType === "ops").map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["wallet.address_disabled", "session.revoked_all", "wallet.address_reactivated"]));
  });

  it("suspend revokes all sessions and blocks sign-in", async () => {
    const w = newSolanaWallet();
    const s = await signIn(app, w, "solana", "mobile");
    expect(await suspendUser({ userId: s.userId, reason: "fraud review", operator: "ops@bytesac", requestId: "ops-3" })).toBe(1);
    expect((await signIn(app, w, "solana")).res.body.error.code).toBe("USER_NOT_ACTIVE");
  });

  it("requires a reason and an operator", async () => {
    await expect(disableAddress({ chain: "base", address: newEvmWallet().address, reason: "", operator: "x", requestId: "r" })).rejects.toThrow();
  });
});
