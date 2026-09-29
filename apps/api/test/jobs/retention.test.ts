import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema/index.js";
import { runRetention } from "../../src/jobs/retention.js";
import { buildTestApp } from "../helpers/app.js";
import { signIn } from "../helpers/auth.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";
import { newEvmWallet } from "../helpers/wallets.js";

beforeEach(resetDb);

describe("retention", () => {
  it("purges only eligible rows and keeps evidence and audit", async () => {
    const { app } = buildTestApp();
    const s = await signIn(app, newEvmWallet(), "base");   // challenge referenced by wallet_addresses → kept
    await adminSql`INSERT INTO app.auth_challenges (id, nonce, purpose, chain_family, chain, address, message, domain, uri, chain_id, status, issued_at, expires_at)
      VALUES (gen_random_uuid(), 'old1', 'sign_in', 'evm', 'base', '0x1', 'm', 'd', 'u', '8453', 'rejected', now() - interval '9 days', now() - interval '8 days'),
             (gen_random_uuid(), 'new1', 'sign_in', 'evm', 'base', '0x1', 'm', 'd', 'u', '8453', 'pending', now(), now() + interval '5 minutes')`;
    await adminSql`UPDATE app.auth_challenges SET expires_at = now() - interval '8 days' WHERE nonce NOT IN ('old1','new1')`;
    await adminSql`INSERT INTO app.sessions (id, user_id, token_hash, client, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
      VALUES (gen_random_uuid(), ${s.userId}, 'h-old', 'web', now() - interval '100 days', now() - interval '95 days', now() - interval '91 days', 'logout')`;
    const retention = postgres(process.env.TEST_DATABASE_URL!.replace("bytesac_api:bytesac_api_dev", "bytesac_retention:bytesac_retention_dev"), { max: 1 });
    try {
      const out = await runRetention(drizzle(retention, { schema }), "retention-test");
      expect(out).toEqual({ challenges: 1, sessions: 1, verifications: 0 });
    } finally { await retention.end(); }
    const left = await adminSql<{ nonce: string }[]>`SELECT nonce FROM app.auth_challenges`;
    expect(left.map((r) => r.nonce)).toContain("new1");
    expect(left).toHaveLength(2);
    const audit = await testDb.db.select().from(schema.auditEvents);
    expect(audit.find((a) => a.action === "retention.purged")?.metadata).toEqual({ challenges: 1, sessions: 1, verifications: 0 });
    expect(audit.length).toBeGreaterThan(1);
  });
});
