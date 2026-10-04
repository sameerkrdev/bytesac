import type { MeResponse } from "@repo/validator";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: (NavItem & { adminOnly?: boolean })[] };

const OPS: NavGroup[] = [
  { label: "Review", items: [{ href: "/ops/applications", label: "Applications" }, { href: "/ops/organizations", label: "Organizations" }, { href: "/ops/members", label: "Members" }] },
  { label: "Catalog", items: [{ href: "/ops/assets", label: "Assets" }, { href: "/ops/baskets", label: "Baskets" }, { href: "/ops/manager-profiles", label: "Manager profiles" }, { href: "/ops/tags", label: "Tags", adminOnly: true }, { href: "/ops/disclosures", label: "Disclosures", adminOnly: true }] },
  { label: "Money", items: [{ href: "/ops/fees", label: "Fees" }, { href: "/ops/routing", label: "Routing" }, { href: "/ops/revenue", label: "Revenue" }] },
  { label: "Access", items: [{ href: "/ops/roles", label: "Roles", adminOnly: true }] },
];

/** Marketing navigation for signed-out visitors. */
export const PUBLIC_NAV: NavItem[] = [
  { href: "/baskets", label: "Baskets" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/self-custody", label: "Your wallet" },
  { href: "/for-managers", label: "For managers" },
  { href: "/fees", label: "Fees" },
];

/** The manager workspace sections as a scrolling row (phones and tablets; the sidebar replaces it on desktop). */
export const MANAGER_NAV: NavItem[] = [
  { href: "/organization", label: "Overview" },
  { href: "/organization/baskets", label: "Baskets" },
  { href: "/organization/members", label: "Team" },
  { href: "/organization/roles", label: "Roles & access" },
  { href: "/organization/wallets", label: "Wallets" },
  { href: "/organization/settings", label: "Settings" },
  { href: "/organization/earnings", label: "Earnings" },
];

/**
 * What the header offers for this user. Hiding is a convenience only: every manager and ops API call is authorized server-side.
 * `primary` is the investor's main destinations; `tabs` adds Notifications and Profile for the phone tab bar;
 * `manager` needs an active membership; `ops` needs a platform role (admin-only entries need ops_admin).
 */
export function navFor(me: MeResponse | null): { primary: NavItem[]; tabs: NavItem[]; manager: NavItem[]; ops: NavGroup[] } {
  if (!me) return { primary: PUBLIC_NAV, tabs: [], manager: [], ops: [] };
  const primary: NavItem[] = [{ href: "/home", label: "Home" }, { href: "/baskets", label: "Discover" }, { href: "/portfolio", label: "Portfolio" }];
  const tabs: NavItem[] = [...primary, { href: "/notifications", label: "Alerts" }, { href: "/profile", label: "Profile" }];
  const manager = me.organizations.some((o) => o.membershipStatus === "ACTIVE") ? MANAGER_NAV : [];
  const admin = me.platformRoles.includes("ops_admin");
  const ops = admin || me.platformRoles.includes("ops_reviewer")
    ? OPS.map((g) => ({ ...g, items: g.items.filter((i) => admin || !i.adminOnly) })).filter((g) => g.items.length > 0)
    : [];
  return { primary, tabs, manager, ops };
}

/** The workspace a path belongs to, which decides the second navigation row. */
export const areaOf = (path: string): "ops" | "manager" | null => (path.startsWith("/ops") ? "ops" : path.startsWith("/organization") && !path.startsWith("/organizations") ? "manager" : null);

/** Whether `href` is the current page or a parent of it. `exact` items (workspace overviews) only match themselves. */
export function isCurrent(path: string, href: string, exact = false): boolean {
  if (path === href) return true;
  return !exact && href !== "/" && path.startsWith(`${href}/`);
}
