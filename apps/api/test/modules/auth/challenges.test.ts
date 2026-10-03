import { eq } from "drizzle-orm";
import request from "supertest";
import { authChallenges, sessions } from "@repo/db";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { challengeFor, webHeaders } from "../../helpers/auth";
import { adminSql, resetDb, testDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { newEvmWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

const SMART_WALLET = { address: "0x" + "ab".repeat(20), sign: () => "0x" + "11".repeat(100) };

async function verify(challengeId: string, signature: string) {
  return request(app).post("/v1/auth/verify").set(webHeaders()).send({ challengeId, signature, client: "web" });
}

describe("challenge state machine (through /v1/auth/verify)", () => {
  it("claim then consume once; a consumed challenge cannot be reused", async () => {
    const w = newEvmWallet();
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address });
    const signature = await w.sign(ch.body.message);
    expect((await verify(ch.body.challengeId, signature)).status).toBe(200);
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, ch.body.challengeId)))[0]!.status).toBe("consumed");
    expect((await verify(ch.body.challengeId, signature)).body.error.code).toBe("CHALLENGE_CONSUMED");
  });

  it("a live lease blocks a second claim; releasing after an outage returns the challenge to pending", async () => {
    fakes.evm.behavior = "valid";
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: SMART_WALLET.address });
    let concurrent: request.Response | undefined;
    fakes.evm.onCall = async () => {
      fakes.evm.onCall = null;
      concurrent = await verify(ch.body.challengeId, SMART_WALLET.sign());
    };
    expect((await verify(ch.body.challengeId, SMART_WALLET.sign())).status).toBe(200);
    expect(concurrent?.body.error.code).toBe("CHALLENGE_IN_PROGRESS");

    const again = await challengeFor(app, { purpose: "sign_in", chain: "base", address: SMART_WALLET.address });
    fakes.evm.behavior = "unavailable";
    expect((await verify(again.body.challengeId, SMART_WALLET.sign())).status).toBe(503);
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, again.body.challengeId)))[0]!.status).toBe("pending");
  });

  it("an invalid signature rejects the challenge for good", async () => {
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: newEvmWallet().address });
    expect((await verify(ch.body.challengeId, "0x" + "11".repeat(65))).status).toBe(401);
    expect((await db.select().from(authChallenges).where(eq(authChallenges.id, ch.body.challengeId)))[0]!.status).toBe("rejected");
    expect((await verify(ch.body.challengeId, "0x" + "11".repeat(65))).body.error.code).toBe("CHALLENGE_CONSUMED");
  });

  it("an expired lease can be re-claimed; an expired challenge cannot", async () => {
    fakes.evm.behavior = "valid";
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: SMART_WALLET.address });
    await adminSql`UPDATE app.auth_challenges SET status = 'processing', claim_id = gen_random_uuid(), lease_expires_at = now() - interval '1 second' WHERE id = ${ch.body.challengeId}`;
    expect((await verify(ch.body.challengeId, SMART_WALLET.sign())).status).toBe(200);
    const old = await challengeFor(app, { purpose: "sign_in", chain: "base", address: newEvmWallet().address });
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '1 second' WHERE id = ${old.body.challengeId}`;
    expect((await verify(old.body.challengeId, "0x00")).body.error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("a stale claimant cannot consume after its lease was taken over", async () => {
    fakes.evm.behavior = "valid";
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: SMART_WALLET.address });
    fakes.evm.onCall = async () => {
      await adminSql`UPDATE app.auth_challenges SET claim_id = gen_random_uuid() WHERE id = ${ch.body.challengeId}`;
    };
    const res = await verify(ch.body.challengeId, SMART_WALLET.sign());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHALLENGE_IN_PROGRESS");
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
