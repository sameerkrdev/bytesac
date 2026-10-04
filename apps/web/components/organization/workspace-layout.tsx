"use client";

import { MEMBERSHIP_ROLE_LABEL, ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationPermission } from "@repo/validator";
import { ArrowUpRight, Coins, KeyRound, Layers, LayoutGrid, Settings2, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isCurrent } from "@/components/layout/nav";
import { Monogram } from "@/components/layout/profile-hero";
import { useOrgWorkspace } from "@/components/organization/workspace";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; needs?: OrganizationPermission };

/** The workspace map. Hiding an entry is a convenience only: every call behind it is authorized server-side. */
export const WORKSPACE_GROUPS: { label: string; items: Item[] }[] = [
  { label: "Workspace", items: [{ href: "/organization", label: "Overview", icon: LayoutGrid, exact: true }, { href: "/organization/baskets", label: "Baskets", icon: Layers }] },
  { label: "People", items: [{ href: "/organization/members", label: "Team", icon: Users }, { href: "/organization/roles", label: "Roles & access", icon: KeyRound }] },
  {
    label: "Organization",
    items: [
      { href: "/organization/wallets", label: "Wallets", icon: Wallet }, { href: "/organization/settings", label: "Settings", icon: Settings2 },
      { href: "/organization/earnings", label: "Earnings", icon: Coins, needs: "earnings.read" },
    ],
  },
];

/**
 * The manager workspace frame: a sticky sidebar with the organization's identity, a switcher when the user belongs to
 * several, and the grouped sections; the page on the right. Phones use the section row in the app header instead.
 */
export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { mine, row, org } = useOrgWorkspace(path);
  const name = org ? String((org.currentVersion ?? org.openVersion)?.publicProfile.displayName ?? "Your organization") : row?.displayName ?? "Your organization";
  const query = row && mine.length > 1 ? `?org=${row.id}` : "";
  const can = (p?: OrganizationPermission) => !p || !org || org.myPermissions.includes(p);
  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] xl:gap-14">
      <aside aria-label="Manager workspace" className="hidden lg:block">
        <div className="sticky top-24 space-y-6">
          <div className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-3">
              <Monogram name={name} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{name}</p>
                <p className="truncate text-xs text-ink-muted">{row ? MEMBERSHIP_ROLE_LABEL[row.role] : "Manager workspace"}</p>
              </div>
            </div>
            {org && <div className="mt-3"><StatusBadge {...ORGANIZATION_STATUS_LABEL[org.status]} /></div>}
            {mine.length > 1 && (
              <details className="group mt-3 border-t border-line pt-3">
                <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-xs text-ink-muted hover:text-ink">Switch organization<span aria-hidden className="transition-transform group-open:rotate-90">›</span></summary>
                <ul className="mt-1 space-y-0.5">
                  {mine.map((o) => (
                    <li key={o.id}>
                      <Link href={`${path}?org=${o.id}`} aria-current={o.id === row?.id ? "true" : undefined}
                        className={cn("block truncate rounded-control px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink", o.id === row?.id && "bg-surface-muted text-ink")}>
                        {o.displayName ?? "Unnamed organization"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <nav aria-label="Workspace sections" className="space-y-5">
            {WORKSPACE_GROUPS.map((g) => (
              <div key={g.label} className="space-y-1">
                <p className="px-3 type-eyebrow text-ink-faint">{g.label}</p>
                <ul className="space-y-0.5">
                  {g.items.filter((i) => can(i.needs)).map((i) => {
                    const current = isCurrent(path, i.href, i.exact);
                    return (
                      <li key={i.href}>
                        <Link href={`${i.href}${query}`} aria-current={current ? "page" : undefined}
                          className={cn("flex min-h-10 items-center gap-3 rounded-control px-3 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink", current && "bg-surface text-ink shadow-soft ring-1 ring-line")}>
                          <i.icon aria-hidden className={cn("size-4", current ? "text-ink" : "text-ink-faint")} />{i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="space-y-0.5 border-t border-line pt-4">
            {row && <Link href={`/organization/membership/${row.membershipId}`} className="flex min-h-10 items-center gap-3 rounded-control px-3 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"><UserRound aria-hidden className="size-4 text-ink-faint" />Your membership</Link>}
            {org?.status === "VERIFIED" && <Link href={`/organizations/${org.id}`} className="flex min-h-10 items-center gap-3 rounded-control px-3 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"><ArrowUpRight aria-hidden className="size-4 text-ink-faint" />Public page</Link>}
          </div>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
