"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSIGNMENT_FLAG_LABEL, ASSIGNMENT_STATUS_LABEL, MEMBERSHIP_ROLE_LABEL } from "@repo/app-core";
import { ASSIGNMENT_FLAGS, CO_MANAGER_DEFAULT_FLAGS, LEAD_FLAGS, type AssignmentFlag, type BasketDetail } from "@repo/validator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { ConfirmReason } from "./confirm-reason";

type Client = Pick<ApiClient, "listOrganizationMembers" | "addBasketAssignment" | "updateBasketAssignment" | "endBasketAssignment">;

const ROLE = { lead: "Lead", co_manager: "Co-manager" } as const;
// Only members holding baskets.manage can be assigned (see the permission matrix).
const CAN_MANAGE_BASKETS = ["OWNER", "ADMIN", "MANAGER"];

export function AssignmentsPanel({ detail, onChange, client = api }: { detail: BasketDetail; onChange(d: BasketDetail): void; client?: Client }) {
  const canAssign = detail.myPermissions.includes("assign");
  const live = detail.assignments.filter((a) => a.status === "ACTIVE" || a.status === "PENDING_APPROVAL");
  const former = detail.assignments.filter((a) => a.status === "ENDED" || a.status === "REJECTED");
  const members = useQuery({ queryKey: ["organization", detail.organizationId, "members"], queryFn: () => client.listOrganizationMembers(detail.organizationId), enabled: canAssign, retry: false });
  const candidates = (members.data?.members ?? []).filter((m) => m.status === "ACTIVE" && CAN_MANAGE_BASKETS.includes(m.role) && !live.some((a) => a.membershipId === m.id));
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState<"lead" | "co_manager">("co_manager");
  const [flags, setFlags] = useState<AssignmentFlag[]>([...CO_MANAGER_DEFAULT_FLAGS]);
  const act = useMutation({ mutationFn: (run: () => Promise<BasketDetail>) => run(), onSuccess: onChange });
  const shown = role === "lead" ? LEAD_FLAGS : flags;

  return (
    <div className="space-y-6">
      <ul aria-label="Managers" className="divide-y divide-border-dark">
        {live.map((a) => (
          <li key={a.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-ivory">{a.displayName ?? "Team member"}{a.isSelf && " (you)"}</span>
              <span className="text-xs text-stone">{ROLE[a.role]}</span>
              <StatusBadge {...ASSIGNMENT_STATUS_LABEL[a.status]} />
            </div>
            {a.role === "co_manager" && canAssign ? (
              <div className="flex flex-wrap gap-4">
                {ASSIGNMENT_FLAGS.map((f) => (
                  <label key={f} className="flex min-h-11 items-center gap-2 text-sm text-ivory">
                    <input type="checkbox" className="size-4" checked={a.permissions.includes(f)} disabled={act.isPending || (a.permissions.length === 1 && a.permissions.includes(f))}
                      onChange={(e) => act.mutate(() => client.updateBasketAssignment(detail.id, a.id, { permissions: e.target.checked ? [...a.permissions, f] : a.permissions.filter((x) => x !== f) }))} />
                    {ASSIGNMENT_FLAG_LABEL[f]}
                  </label>
                ))}
              </div>
            ) : <p className="text-xs text-stone">{a.permissions.map((f) => ASSIGNMENT_FLAG_LABEL[f]).join(", ")}</p>}
            {(canAssign || a.isSelf) && (
              <ConfirmReason label="End assignment" reasonLabel="Reason" destructive pending={act.isPending}
                description="This manager loses access to this basket. The history is kept. A basket without a lead needs a new lead approved by Bytesac."
                onConfirm={(reason) => act.mutate(() => client.endBasketAssignment(detail.id, a.id, { reason }))} />
            )}
          </li>
        ))}
      </ul>
      {former.length > 0 && (
        <section aria-label="Former managers" className="space-y-2">
          <h4 className="text-sm font-medium text-ivory">Former managers</h4>
          <ul className="text-xs text-stone">{former.map((a) => <li key={a.id}>{a.displayName ?? "Team member"} · {ROLE[a.role]} · {ASSIGNMENT_STATUS_LABEL[a.status].label}</li>)}</ul>
        </section>
      )}

      {canAssign && (
        <form className="space-y-3 rounded-xl border border-border-dark p-4" aria-label="Add a manager" onSubmit={(e) => { e.preventDefault(); if (membershipId) act.mutate(() => client.addBasketAssignment(detail.id, { membershipId, role, permissions: role === "lead" ? undefined : flags })); }}>
          <h4 className="text-sm font-medium text-ivory">Add a manager</h4>
          <div className="space-y-1">
            <Label htmlFor="assign-member" className="text-xs font-medium text-ivory">Member</Label>
            <Select id="assign-member" value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              <option value="">Select a member</option>
              {candidates.map((m) => <option key={m.id} value={m.id}>{m.publicDisplayName ?? "Unnamed member"} · {MEMBERSHIP_ROLE_LABEL[m.role]}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="assign-role" className="text-xs font-medium text-ivory">Role</Label>
            <Select id="assign-role" value={role} onChange={(e) => setRole(e.target.value as "lead" | "co_manager")}>
              <option value="co_manager">Co-manager</option>
              <option value="lead">Lead</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-4" role="group" aria-label="Access">
            {ASSIGNMENT_FLAGS.map((f) => (
              <label key={f} className="flex min-h-11 items-center gap-2 text-sm text-ivory">
                <input type="checkbox" className="size-4" checked={shown.includes(f)} disabled={role === "lead"} onChange={(e) => setFlags((c) => (e.target.checked ? [...c, f] : c.filter((x) => x !== f)))} />
                {ASSIGNMENT_FLAG_LABEL[f]}
              </label>
            ))}
          </div>
          {role === "lead" && <p className="text-xs text-stone">A lead always has full access. A new lead on a published basket needs approval from Bytesac; the current lead stays until then.</p>}
          <Button type="submit" className="min-h-11" disabled={!membershipId || shown.length === 0 || act.isPending}>{act.isPending && <Loader2 aria-hidden className="animate-spin" />}Add manager</Button>
        </form>
      )}
      {act.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(act.error).title}</span> {toDisplayError(act.error).message}</p>}
    </div>
  );
}
