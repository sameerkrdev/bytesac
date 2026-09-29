import type { ClientKind } from "@repo/contracts";
import { eq } from "drizzle-orm";
import type { Tx } from "../../../db/client.js";
import { sessions } from "../../../db/schema/index.js";
import { DomainError } from "../../../shared/errors.js";
import { writeAudit } from "../../../shared/audit.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { sessionRepo, type IssuedSession } from "../infra/session-repository.js";

/** Issue a replacement session and revoke the old one inside the caller's transaction. */
export async function rotateSession(tx: Tx, i: { userId: string; oldSessionId: string; client: ClientKind; pepper: string; meta: RequestMeta }): Promise<IssuedSession> {
  // Revoke first: if the old session is already revoked (e.g. concurrent logout) refuse and let the caller's tx roll back.
  const revoked = await sessionRepo.revoke(tx, i.oldSessionId, "rotated");
  if (!revoked) throw new DomainError("SESSION_EXPIRED", "Please sign in again");
  const next = await sessionRepo.create(tx, { userId: i.userId, client: i.client, pepper: i.pepper, meta: i.meta });
  await tx.update(sessions).set({ replacedBySessionId: next.id }).where(eq(sessions.id, i.oldSessionId));
  await writeAudit(tx, {
    actorType: "user", actorUserId: i.userId, action: "session.rotated", entityType: "session", entityId: next.id,
    requestId: i.meta.requestId, sessionId: next.id, metadata: { previousSessionId: i.oldSessionId },
  });
  return next;
}
