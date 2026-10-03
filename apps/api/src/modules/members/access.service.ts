import createHttpError from "http-errors";
import { and, eq } from "drizzle-orm";
import { organizationMemberships, organizations, type DbOrTx } from "@repo/db";
import { ROLE_PERMISSIONS, type OrganizationPermission } from "@repo/validator";
import type { OrganizationRow } from "@/modules/organizations/organizations.service";

export type MembershipRow = typeof organizationMemberships.$inferSelect;

export const notFound = () => createHttpError("Organization not found", { code: "NOT_FOUND" });

export const forbidden = () => createHttpError("You don't have access to this organization.", { code: "FORBIDDEN" });

/**
 * Guard for every organization route: 404 for an unknown organization, 403 unless the user holds an ACTIVE membership whose role grants `permission`.
 * `lock` takes the organization row FOR UPDATE (use inside a transaction): every member-management writer takes it before locking membership rows.
 */
export async function requirePermission(conn: DbOrTx, userId: string, orgId: string, permission: OrganizationPermission, lock = false): Promise<{ org: OrganizationRow; membership: MembershipRow }> {
  const query = conn.select().from(organizations).where(eq(organizations.id, orgId));
  const [org] = await (lock ? query.for("update") : query);
  if (!org) throw notFound();
  const [membership] = await conn.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "ACTIVE"),
  ));
  if (!membership || !ROLE_PERMISSIONS[membership.role].includes(permission)) throw forbidden();
  return { org, membership };
}
