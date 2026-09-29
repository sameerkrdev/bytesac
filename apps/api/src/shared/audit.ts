import type { DbOrTx } from "@repo/db";
import { auditEvents } from "@repo/db";

export type AuditAction =
  | "user.signed_up" | "user.signed_in" | "user.suspended" | "wallet.chain_account_added"
  | "wallet.address_disabled" | "wallet.address_reactivated" | "session.created" | "session.rotated"
  | "session.revoked" | "session.revoked_all" | "contact.added" | "contact.replaced" | "contact.verified"
  | "notification_preferences.updated" | "challenge.rejected" | "retention.purged";

export interface AuditEntry {
  actorType: "user" | "ops" | "system";
  actorUserId?: string | null;
  actorOpsId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  requestId: string;
  sessionId?: string | null;
  challengeId?: string | null;
  /** Never put tokens, signatures, OTP codes or unmasked contact values here. */
  metadata?: Record<string, unknown>;
}

export async function writeAudit(db: DbOrTx, e: AuditEntry): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    actorOpsId: e.actorOpsId ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    requestId: e.requestId,
    sessionId: e.sessionId ?? null,
    challengeId: e.challengeId ?? null,
    metadata: e.metadata ?? {},
  });
}
