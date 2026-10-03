import type { MeResponse } from "@repo/validator";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: (NavItem & { adminOnly?: boolean })[] };

const OPS: NavGroup[] = [
  { label: "Review", items: [{ href: "/ops/applications", label: "Applications" }, { href: "/ops/organizations", label: "Organizations" }, { href: "/ops/members", label: "Members" }] },
  { label: "Catalog", items: [{ href: "/ops/assets", label: "Assets" }, { href: "/ops/baskets", label: "Baskets" }, { href: "/ops/manager-profiles", label: "Manager profiles" }, { href: "/ops/tags", label: "Tags", adminOnly: true }, { href: "/ops/disclosures", label: "Disclosures", adminOnly: true }] },
  { label: "Money", items: [{ href: "/ops/fees", label: "Fees" }, { href: "/ops/routing", label: "Routing" }, { href: "/ops/revenue", label: "Revenue" }] },
  { label: "Access", items: [{ href: "/ops/roles", label: "Roles", adminOnly: true }] },
];

/**
 * What the header offers for this user. Hiding is a convenience only: every manager and ops API call is authorized server-side.
 * `primary` is always there; `manager` needs an active membership; `ops` needs a platform role (admin-only entries need ops_admin).
 */
export function navFor(me: MeResponse | null): { primary: NavItem[]; manager: NavItem[]; ops: NavGroup[] } {
  if (!me) return { primary: [{ href: "/baskets", label: "Discover" }, { href: "/fees", label: "Fees" }], manager: [], ops: [] };
  const primary: NavItem[] = [{ href: "/baskets", label: "Discover" }, { href: "/portfolio", label: "Portfolio" }, { href: "/notifications", label: "Notifications" }, { href: "/profile", label: "Profile" }];
  const manager = me.organizations.some((o) => o.membershipStatus === "ACTIVE")
    ? [{ href: "/organization", label: "Organization" }, { href: "/organization#baskets", label: "Baskets" }, { href: "/organization/earnings", label: "Earnings" }]
    : [];
  const admin = me.platformRoles.includes("ops_admin");
  const ops = admin || me.platformRoles.includes("ops_reviewer")
    ? OPS.map((g) => ({ ...g, items: g.items.filter((i) => admin || !i.adminOnly) })).filter((g) => g.items.length > 0)
    : [];
  return { primary, manager, ops };
}

/** The workspace a path belongs to, which decides the second navigation row. */
export const areaOf = (path: string): "ops" | "manager" | null => (path.startsWith("/ops") ? "ops" : path.startsWith("/organization") && !path.startsWith("/organizations") ? "manager" : null);
