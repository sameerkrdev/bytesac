import createHttpError from "http-errors";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { db, platformRoles, users, type DbOrTx } from "@repo/db";
import type { PlatformRole, PlatformRoleView } from "@repo/validator";
import { writeAudit } from "@/modules/audit/audit.service";

/** Who performs a role change: a signed-in ops admin, or an operator running the CLI. */
export type RoleActor = { userId: string; requestId: string } | { operator: string; requestId: string };

const auditActor = (a: RoleActor) => ("userId" in a
  ? { actorType: "user" as const, actorUserId: a.userId, requestId: a.requestId }
  : { actorType: "ops" as const, actorOpsId: a.operator, requestId: a.requestId });

const roleView = (r: typeof platformRoles.$inferSelect): PlatformRoleView => ({
  id: r.id, userId: r.userId, role: r.role, grantedByUserId: r.grantedByUserId, grantedAt: r.grantedAt.toISOString(),
});

export async function activeRoles(conn: DbOrTx, userId: string): Promise<PlatformRole[]> {
  const rows = await conn.select({ role: platformRoles.role }).from(platformRoles).where(and(eq(platformRoles.userId, userId), isNull(platformRoles.revokedAt)));
  return rows.map((r) => r.role);
}

export async function listRoles(): Promise<PlatformRoleView[]> {
  const rows = await db.select().from(platformRoles).where(isNull(platformRoles.revokedAt)).orderBy(platformRoles.grantedAt, platformRoles.id);
  return rows.map(roleView);
}

/** Idempotent: an already-active role is returned unchanged, without a second audit entry. */
export async function grantRole(actor: RoleActor, userId: string, role: PlatformRole): Promise<PlatformRoleView> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId));
    if (!user || user.status !== "active") throw createHttpError("User not found", { code: "NOT_FOUND" });
    const [created] = await tx.insert(platformRoles).values({ userId, role, grantedByUserId: "userId" in actor ? actor.userId : null }).onConflictDoNothing().returning();
    if (!created) {
      const [existing] = await tx.select().from(platformRoles).where(and(eq(platformRoles.userId, userId), eq(platformRoles.role, role), isNull(platformRoles.revokedAt)));
      return roleView(existing!);
    }
    await writeAudit(tx, { ...auditActor(actor), action: "platform_role.granted", entityType: "user", entityId: userId, metadata: { role, roleId: created.id } });
    return roleView(created);
  });
}

export async function revokeRole(actor: RoleActor, roleRowId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(platformRoles).where(and(eq(platformRoles.id, roleRowId), isNull(platformRoles.revokedAt)));
    if (!row) throw createHttpError("Role not found", { code: "NOT_FOUND" });
    if (row.role === "ops_admin") {
      // Every admin revoke locks all active admin rows in one order: racing revokes serialise (no deadlock) and cannot both remove the last admin.
      const admins = await tx.select({ id: platformRoles.id }).from(platformRoles)
        .where(and(eq(platformRoles.role, "ops_admin"), isNull(platformRoles.revokedAt))).orderBy(platformRoles.id).for("update");
      if (!admins.some((a) => a.id === row.id)) throw createHttpError("Role not found", { code: "NOT_FOUND" });
      // Suspended admins cannot use the role, so another active admin must remain.
      const [others] = await tx.select({ n: count() }).from(platformRoles).innerJoin(users, eq(users.id, platformRoles.userId))
        .where(and(eq(platformRoles.role, "ops_admin"), isNull(platformRoles.revokedAt), ne(platformRoles.id, row.id), eq(users.status, "active")));
      if (others!.n === 0) throw createHttpError("At least one ops admin must remain.", { code: "INVALID_TRANSITION" });
    }
    const revoked = await tx.update(platformRoles).set({ revokedAt: sql`now()`, revokedByUserId: "userId" in actor ? actor.userId : null })
      .where(and(eq(platformRoles.id, row.id), isNull(platformRoles.revokedAt))).returning({ id: platformRoles.id });
    if (revoked.length === 0) throw createHttpError("Role not found", { code: "NOT_FOUND" });
    await writeAudit(tx, { ...auditActor(actor), action: "platform_role.revoked", entityType: "user", entityId: row.userId, metadata: { role: row.role, roleId: row.id } });
  });
}
