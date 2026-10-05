import createHttpError from "http-errors";
import { and, asc, count, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db, isUniqueViolation, organizationMemberships, organizationRoles, type Tx } from "@repo/db";
import {
  ROLE_PERMISSIONS, customRoleProblems,
  type AssignCustomRoleRequest, type CreateCustomRoleRequest, type CustomRoleView, type ListMembersResponse, type ListRolesResponse, type MembershipRole, type UpdateCustomRoleRequest,
} from "@repo/validator";
import { writeAudit } from "@/modules/audit/audit.service";
import { endIneligibleAssignments, notifyReassignmentRequired } from "@/modules/baskets/baskets.service";
import type { OwnerCtx } from "@/modules/organizations/organizations.service";
import { forbidden, requirePermission } from "./access.service";
import { listMembers } from "./members.service";

/*
 * Custom roles (ADR-019). Defining or changing a role is owner-only (`members.manage_admins`): a role can add read grants
 * to a base role. Assigning one follows the same rules as changing a member's role: `members.manage`, and only the OWNER
 * touches an ADMIN. Every change is audited, and members who lose `baskets.manage` lose their basket assignments.
 */

const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const roleNotFound = () => createHttpError("Role not found", { code: "NOT_FOUND" });
const TERMINAL = ["REJECTED", "REVOKED"] as const;
const BUILT_IN: MembershipRole[] = ["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"];

type RoleRow = typeof organizationRoles.$inferSelect;

async function view(conn: Tx | typeof db, r: RoleRow): Promise<CustomRoleView> {
  const [{ n }] = await conn.select({ n: count() }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.customRoleId, r.id), eq(organizationMemberships.status, "ACTIVE"))) as [{ n: number }];
  return {
    id: r.id, name: r.name, description: r.description, baseRole: r.baseRole as CustomRoleView["baseRole"], permissions: r.permissions as CustomRoleView["permissions"],
    memberCount: n, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

async function lockRole(tx: Tx, orgId: string, rid: string): Promise<RoleRow> {
  const [r] = await tx.select().from(organizationRoles).where(and(eq(organizationRoles.id, rid), eq(organizationRoles.organizationId, orgId), isNull(organizationRoles.archivedAt))).for("update");
  if (!r) throw roleNotFound();
  return r;
}

/** Ends basket assignments of every live holder of the role that no longer manages baskets. */
async function recheckHolders(tx: Tx, rid: string, ctx: OwnerCtx) {
  const holders = await tx.select({ id: organizationMemberships.id }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.customRoleId, rid), notInArray(organizationMemberships.status, [...TERMINAL])));
  for (const h of holders) await endIneligibleAssignments(tx, h.id, ctx.meta.requestId, ctx.userId);
}

export async function listRoles(ctx: OwnerCtx, orgId: string): Promise<ListRolesResponse> {
  await requirePermission(db, ctx.userId, orgId, "org.read");
  const rows = await db.select().from(organizationRoles).where(and(eq(organizationRoles.organizationId, orgId), isNull(organizationRoles.archivedAt))).orderBy(asc(organizationRoles.baseRole), asc(organizationRoles.name));
  return { builtIn: BUILT_IN.map((role) => ({ role, permissions: [...ROLE_PERMISSIONS[role]] })), custom: await Promise.all(rows.map((r) => view(db, r))) };
}

export async function createRole(ctx: OwnerCtx, orgId: string, body: CreateCustomRoleRequest): Promise<ListRolesResponse> {
  try {
    await db.transaction(async (tx) => {
      await requirePermission(tx, ctx.userId, orgId, "members.manage_admins", true);
      const [r] = await tx.insert(organizationRoles).values({
        organizationId: orgId, name: body.name, description: body.description ?? null, baseRole: body.baseRole, permissions: body.permissions, createdByUserId: ctx.userId,
      }).returning({ id: organizationRoles.id });
      await writeAudit(tx, {
        actorType: "user", actorUserId: ctx.userId, action: "organization_role.created", entityType: "organization_role", entityId: r!.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId,
        metadata: { organizationId: orgId, baseRole: body.baseRole, permissions: body.permissions },
      });
    });
  } catch (err) {
    throw isUniqueViolation(err, "organization_roles_live_name") ? createHttpError("Another role already has that name.", { code: "ROLE_NAME_TAKEN" }) : err;
  }
  return listRoles(ctx, orgId);
}

/** Renames or re-scopes a role. New permissions are checked against its base role and apply at once to its holders. */
export async function updateRole(ctx: OwnerCtx, orgId: string, rid: string, body: UpdateCustomRoleRequest): Promise<ListRolesResponse> {
  try {
    await db.transaction(async (tx) => {
      await requirePermission(tx, ctx.userId, orgId, "members.manage_admins", true);
      const r = await lockRole(tx, orgId, rid);
      if (body.permissions) {
        const problems = customRoleProblems(r.baseRole as Exclude<MembershipRole, "OWNER">, body.permissions);
        if (problems.length) throw createHttpError(400, problems.join(" "), { code: "VALIDATION_FAILED" });
      }
      await tx.update(organizationRoles).set({
        ...(body.name !== undefined && { name: body.name }), ...(body.description !== undefined && { description: body.description }),
        ...(body.permissions && { permissions: body.permissions }), updatedAt: sql`now()`,
      }).where(eq(organizationRoles.id, rid));
      if (body.permissions) await recheckHolders(tx, rid, ctx);
      await writeAudit(tx, {
        actorType: "user", actorUserId: ctx.userId, action: "organization_role.updated", entityType: "organization_role", entityId: rid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId,
        metadata: { organizationId: orgId, ...(body.permissions && { from: r.permissions, to: body.permissions }), ...(body.name !== undefined && { name: body.name }) },
      });
    });
  } catch (err) {
    throw isUniqueViolation(err, "organization_roles_live_name") ? createHttpError("Another role already has that name.", { code: "ROLE_NAME_TAKEN" }) : err;
  }
  await notifyReassignmentRequired(ctx.meta.requestId);
  return listRoles(ctx, orgId);
}

/** Archives a role; its holders fall back to their built-in role's permissions. The row stays for history. */
export async function archiveRole(ctx: OwnerCtx, orgId: string, rid: string): Promise<ListRolesResponse> {
  await db.transaction(async (tx) => {
    await requirePermission(tx, ctx.userId, orgId, "members.manage_admins", true);
    await lockRole(tx, orgId, rid);
    const released = await tx.update(organizationMemberships).set({ customRoleId: null, updatedAt: sql`now()` }).where(eq(organizationMemberships.customRoleId, rid)).returning({ id: organizationMemberships.id });
    await tx.update(organizationRoles).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationRoles.id, rid));
    for (const m of released) await endIneligibleAssignments(tx, m.id, ctx.meta.requestId, ctx.userId);
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_role.archived", entityType: "organization_role", entityId: rid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId,
      metadata: { organizationId: orgId, released: released.length },
    });
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  return listRoles(ctx, orgId);
}

/** Gives a member a custom role for their current base role, or clears it (`null`). */
export async function assignRole(ctx: OwnerCtx, orgId: string, mid: string, body: AssignCustomRoleRequest): Promise<ListMembersResponse> {
  await db.transaction(async (tx) => {
    const { membership: actor } = await requirePermission(tx, ctx.userId, orgId, "members.manage", true);
    const [m] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, mid), eq(organizationMemberships.organizationId, orgId))).for("update");
    if (!m || (TERMINAL as readonly string[]).includes(m.status)) throw createHttpError("Member not found", { code: "NOT_FOUND" });
    if (m.role === "OWNER") throw invalid("The owner's permissions can't be changed.");
    // Same rule as role changes: only the OWNER changes what an ADMIN can do (owner-only permissions never delegate).
    if (m.role === "ADMIN" && !ROLE_PERMISSIONS[actor.role].includes("members.manage_admins")) throw forbidden();
    if (body.customRoleId) {
      const [r] = await tx.select().from(organizationRoles).where(and(eq(organizationRoles.id, body.customRoleId), eq(organizationRoles.organizationId, orgId), isNull(organizationRoles.archivedAt)));
      if (!r) throw roleNotFound();
      if (r.baseRole !== m.role) throw invalid(`This role is for members whose base role is ${r.baseRole}.`);
    }
    await tx.update(organizationMemberships).set({ customRoleId: body.customRoleId, updatedAt: sql`now()` }).where(eq(organizationMemberships.id, m.id));
    await endIneligibleAssignments(tx, m.id, ctx.meta.requestId, ctx.userId);
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "membership.custom_role_set", entityType: "organization_membership", entityId: m.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId,
      metadata: { organizationId: orgId, from: m.customRoleId, to: body.customRoleId },
    });
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  return listMembers(ctx, orgId);
}
