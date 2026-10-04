"use client";

import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumb, type Crumb } from "@/components/layout/page-layout";
import { Monogram } from "@/components/layout/profile-hero";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

/**
 * Which organization the workspace shows, and its detail. `?org=` picks it; otherwise the ACTIVE organization the
 * user owns, then any ACTIVE one, then one not rejected. Only an ACTIVE membership can read the organization.
 */
export function useOrgWorkspace(path = "/organization") {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const mine = me?.organizations ?? [];
  const row = mine.find((o) => o.id === params.get("org"))
    ?? mine.find((o) => o.role === "OWNER" && o.membershipStatus === "ACTIVE")
    ?? mine.find((o) => o.membershipStatus === "ACTIVE")
    ?? mine.find((o) => o.status !== "REJECTED")
    ?? mine[0];
  const active = row?.membershipStatus === "ACTIVE";
  const query = useQuery({ queryKey: ["organization", row?.id], queryFn: () => api.getOrganization(row!.id), enabled: Boolean(row?.id) && active, retry: false });
  const setOrg = (d: OrganizationDetail) => { qc.setQueryData(["organization", d.id], d); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const switcher = mine.length > 1 && row ? (
    <div className="max-w-sm space-y-2">
      <Label htmlFor="org-switcher" className="text-xs font-medium text-ink-muted">Organization</Label>
      <Select id="org-switcher" value={row.id} onChange={(e) => router.replace(`${path}?org=${e.target.value}`)}>
        {mine.map((o) => <option key={o.id} value={o.id}>{o.displayName ?? "Unnamed organization"} · {MEMBERSHIP_ROLE_LABEL[o.role]} · {MEMBERSHIP_STATUS_LABEL[o.membershipStatus].label}</option>)}
      </Select>
    </div>
  ) : null;
  return { me, mine, row, active, query, org: query.data, setOrg, switcher, invalidate: () => qc.invalidateQueries({ queryKey: ["organization", row?.id] }) };
}

/** Workspace page header: organization identity, status and the caller's role — denser than investor pages by design. */
export function WorkspaceHeader({ title, id, org, name, crumbs, actions, switcher, badge }: {
  title: ReactNode; id: string; org?: OrganizationDetail; name?: string | null; crumbs?: Crumb[]; actions?: ReactNode; switcher?: ReactNode; badge?: ReactNode;
}) {
  const display = name ?? (org ? String((org.currentVersion ?? org.openVersion)?.publicProfile.displayName ?? "Your organization") : null);
  return (
    <header className="space-y-6 border-b border-line pb-8">
      {crumbs && <Breadcrumb items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          {display && <Monogram name={display} />}
          <div className="min-w-0 space-y-1.5">
            <p className="type-eyebrow text-ink-faint">{display ?? "Manager workspace"}{org && ` · ${MEMBERSHIP_ROLE_LABEL[org.myRole]}`}</p>
            <h1 id={id} className="type-title text-ink">{title}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{badge ?? (org && <StatusBadge {...ORGANIZATION_STATUS_LABEL[org.status]} />)}{actions}</div>
      </div>
      {switcher}
    </header>
  );
}
