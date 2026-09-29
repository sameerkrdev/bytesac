import { sql } from "drizzle-orm";
import type { Db } from "@repo/db";
import { writeAudit } from "../shared/audit.js";

function count(r: unknown): number {
  return (r as { count?: number }).count ?? (r as unknown[]).length ?? 0;
}

export async function runRetention(db: Db, requestId: string): Promise<{ challenges: number; sessions: number; verifications: number }> {
  const challenges = count(await db.execute(sql`
    DELETE FROM app.auth_challenges c
     WHERE c.expires_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM app.wallet_addresses w WHERE w.verification_challenge_id = c.id)`));
  const sessions = count(await db.execute(sql`
    DELETE FROM app.sessions
     WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '90 days')
        OR (revoked_at IS NULL AND LEAST(idle_expires_at, absolute_expires_at) < now() - interval '90 days')`));
  const verifications = count(await db.execute(sql`
    DELETE FROM app.contact_verifications
     WHERE (resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days')
        OR (status = 'pending' AND expires_at < now() - interval '90 days')`));
  const out = { challenges, sessions, verifications };
  await writeAudit(db, { actorType: "system", action: "retention.purged", entityType: "system", entityId: "retention", requestId, metadata: out });
  return out;
}
