"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isCurrent, navFor } from "@/components/layout/nav";
import { useMe } from "@/components/me-context";
import { cn } from "@/lib/utils";

/**
 * The operations console frame: grouped sections in a sticky sidebar (Review, Catalog, Money, Access) beside the page.
 * Phones keep the scrolling section row in the header. Visibility is a convenience; every ops call checks the role.
 */
export function OpsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: me } = useMe();
  const groups = navFor(me ?? null).ops;
  const admin = me?.platformRoles.includes("ops_admin");
  return (
    <div className="grid gap-10 lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:gap-14">
      <aside aria-label="Operations" className="hidden lg:block">
        <div className="sticky top-24 space-y-6">
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-primary text-primary-ink"><ShieldCheck className="size-4" /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Operations</p>
              <p className="text-xs text-ink-muted">{admin ? "Ops admin" : "Ops reviewer"} · every action audited</p>
            </div>
          </div>
          <nav aria-label="Operations sections" className="space-y-5">
            {groups.map((g) => (
              <div key={g.label} className="space-y-1">
                <p className="px-3 type-eyebrow text-ink-faint">{g.label}</p>
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const current = isCurrent(path, i.href);
                    return (
                      <li key={i.href}>
                        <Link href={i.href} aria-current={current ? "page" : undefined}
                          className={cn("flex min-h-9 items-center rounded-control px-3 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink", current && "bg-surface text-ink shadow-soft ring-1 ring-line")}>
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
