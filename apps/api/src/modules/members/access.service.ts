import createHttpError from "http-errors";
import { and, eq } from "drizzle-orm";
import { organizationMemberships, organizationRoles, organizations, type DbOrTx } from "@repo/db";
import { effectiveRolePermissions, type OrganizationPermission } from "@repo/validator";
import type { OrganizationRow } from "@/modules/organizations/organizations.service";

export type MembershipRow = typeof organizationMemberships.$inferSelect;

export const notFound = () => createHttpError("Organization not found", { code: "NOT_FOUND" });

export const forbidden = () => createHttpError("You don't have access to this organization.", { code: "FORBIDDEN" });

/**
 * What a membership can do: its custom role's permissions while that role still applies (same base role, not archived;
 * ADR-019), otherwise the built-in role's. Owner-only permissions never come from a custom role.
 */
export async function membershipPermissions(conn: DbOrTx, m: Pick<MembershipRow, "role" | "customRoleId">): Promise<OrganizationPermission[]> {
  if (!m.customRoleId) return effectiveRolePermissions(m.role, null);
  const [r] = await conn.select({ baseRole: organizationRoles.baseRole, permissions: organizationRoles.permissions, archivedAt: organizationRoles.archivedAt })
    .from(organizationRoles).where(eq(organizationRoles.id, m.customRoleId));
  return effectiveRolePermissions(m.role, r ? { baseRole: r.baseRole, permissions: r.permissions, archived: r.archivedAt !== null } : null);
}

/**
 * Guard for every organization route: 404 for an unknown organization, 403 unless the user holds an ACTIVE membership whose permissions include `permission`.
 * `lock` takes the organization row FOR UPDATE (use inside a transaction): every member-management writer takes it before locking membership rows.
 */
export async function requirePermission(conn: DbOrTx, userId: string, orgId: string, permission: OrganizationPermission, lock = false): Promise<{ org: OrganizationRow; membership: MembershipRow; permissions: OrganizationPermission[] }> {
  const query = conn.select().from(organizations).where(eq(organizations.id, orgId));
  const [org] = await (lock ? query.for("update") : query);
  if (!org) throw notFound();
  const [membership] = await conn.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "ACTIVE"),
  ));
  if (!membership) throw forbidden();
  const permissions = await membershipPermissions(conn, membership);
  if (!permissions.includes(permission)) throw forbidden();
  return { org, membership, permissions };
}
