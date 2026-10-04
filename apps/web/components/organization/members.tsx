"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, MEMBER_VERIFICATION_STATUS_LABEL, PERMISSION_INFO, shortAddress } from "@repo/app-core";
import { CHAINS, signInChainSchema, inviteMemberRequestSchema, type ListMembersResponse, type MemberView, type MembershipRole, type OrganizationDetail } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useId, useState } from "react";
import { Monogram } from "@/components/layout/profile-hero";
import { Summary } from "@/components/organization/roles";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ChoiceCard, Field, StepForm } from "@/components/ui/step-form";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "listOrganizationMembers" | "inviteOrganizationMember" | "cancelMemberInvite" | "changeMemberRole" | "removeMember" | "confirmMemberRemoval" | "cancelMemberRemoval">
  & Partial<Pick<ApiClient, "listOrganizationRoles" | "assignMemberCustomRole">>;
type Confirm = { title: string; description: string; action: string; run(): Promise<ListMembersResponse> };

const ASSIGNABLE: MembershipRole[] = ["ADMIN", "MANAGER", "ANALYST", "VIEWER"];
const OPEN_INVITE = ["PENDING_WALLET_VERIFICATION", "INVITED"];
const PENDING_REVIEW = ["PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED"];
const ROLE_NOTE: Record<Exclude<MembershipRole, "OWNER">, string> = {
  ADMIN: "Team, baskets and earnings. Needs Bytesac verification before it is active.",
  MANAGER: "Works on baskets they're assigned to. Needs Bytesac verification.",
  ANALYST: "Reads the organization and adoption.",
  VIEWER: "Reads the organization.",
};

/** The team: who is in it, their role and what it lets them do, and (with members.manage) invite and role changes. Every action is authorized by the server. */
export function Members({ org, client = api }: { org: OrganizationDetail; client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const key = ["organization", org.id, "members"];
  const can = (p: OrganizationDetail["myPermissions"][number]) => org.myPermissions.includes(p);
  const canManage = can("members.manage");
  const canManageAdmins = can("members.manage_admins");
  const roles = ASSIGNABLE.filter((r) => r !== "ADMIN" || canManageAdmins);
  const list = useQuery({ queryKey: key, queryFn: () => client.listOrganizationMembers(org.id), retry: false });
  const custom = useQuery({ queryKey: ["organization", org.id, "roles"], queryFn: () => client.listOrganizationRoles!(org.id), enabled: canManage && Boolean(client.listOrganizationRoles), retry: false });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [inviting, setInviting] = useState(false);
  const onSuccess = (d: ListMembersResponse) => { qc.setQueryData(key, d); setConfirm(null); };
  const act = useMutation({ mutationFn: (run: () => Promise<ListMembersResponse>) => run(), onSuccess });

  const actError = act.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(act.error).title}</span> {toDisplayError(act.error).message}</p>;
  // A member's row is actionable by the caller only per the matrix: ADMIN rows need members.manage_admins, except that an ADMIN may request an ADMIN's removal.
  const actionable = (m: MemberView) => canManage && !m.isSelf && m.role !== "OWNER" && (m.role !== "ADMIN" || canManageAdmins) && (m.requestedRole !== "ADMIN" || canManageAdmins);
  const who = (m: MemberView) => m.publicDisplayName ?? "this member";

  const actions = (m: MemberView) => {
    if (m.status === "REMOVAL_REQUESTED" && canManageAdmins) {
      return (
        <>
          <Button size="sm" variant="destructive" onClick={() => setConfirm({ title: "Remove this admin?", description: "An admin asked to remove this member. They lose access immediately. Their history is kept.", action: "Confirm removal", run: () => client.confirmMemberRemoval(org.id, m.id) })}>Confirm removal</Button>
          <Button size="sm" variant="secondary" onClick={() => act.mutate(() => client.cancelMemberRemoval(org.id, m.id))}>Cancel request</Button>
        </>
      );
    }
    if (OPEN_INVITE.includes(m.status) && canManage && (m.role !== "ADMIN" || canManageAdmins)) {
      return <Button size="sm" variant="secondary" onClick={() => setConfirm({ title: "Cancel this invitation?", description: "The invitation can no longer be accepted.", action: "Cancel invitation", run: () => client.cancelMemberInvite(org.id, m.id) })}>Cancel invite</Button>;
    }
    // Nobody touches an ADMIN, or an ADMIN promotion in flight, without members.manage_admins; removing yourself is leaving.
    const removable = canManage && !m.isSelf && m.role !== "OWNER" && (m.requestedRole !== "ADMIN" || canManageAdmins);
    if (PENDING_REVIEW.includes(m.status)) {
      return removable && (m.role !== "ADMIN" || canManageAdmins)
        ? <Button size="sm" variant="secondary" onClick={() => setConfirm({ title: "Withdraw this membership?", description: "The member's verification is closed and they lose the membership. Their history is kept.", action: "Withdraw membership", run: () => client.removeMember(org.id, m.id) })}>Withdraw</Button>
        : null;
    }
    if (m.status !== "ACTIVE") return null;
    const request = m.role === "ADMIN" && !canManageAdmins;
    const options = (custom.data?.custom ?? []).filter((r) => r.baseRole === m.role);
    return (
      <>
        {actionable(m) && (
          <>
            <Label htmlFor={`${id}-role-${m.id}`} className="sr-only">Role for {who(m)}</Label>
            <Select id={`${id}-role-${m.id}`} className="h-9 w-auto min-h-9 text-sm" value={m.role} onChange={(e) => { const role = e.target.value as Exclude<MembershipRole, "OWNER">; act.mutate(() => client.changeMemberRole(org.id, m.id, { role })); }}>
              {[...new Set([m.role, ...roles])].map((r) => <option key={r} value={r}>{MEMBERSHIP_ROLE_LABEL[r]}</option>)}
            </Select>
            {client.assignMemberCustomRole && (options.length > 0 || m.customRole) && (
              <>
                <Label htmlFor={`${id}-custom-${m.id}`} className="sr-only">Custom role for {who(m)}</Label>
                <Select id={`${id}-custom-${m.id}`} className="h-9 w-auto min-h-9 text-sm" value={m.customRole?.id ?? ""}
                  onChange={(e) => { const customRoleId = e.target.value || null; act.mutate(() => client.assignMemberCustomRole!(org.id, m.id, { customRoleId })); }}>
                  <option value="">Standard {MEMBERSHIP_ROLE_LABEL[m.role]}</option>
                  {options.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </>
            )}
          </>
        )}
        {removable && (
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm(request
            ? { title: "Request removal of this admin?", description: "Only the owner can remove an admin. They will be asked to confirm.", action: "Request removal", run: () => client.removeMember(org.id, m.id) }
            : { title: "Remove this member?", description: "They lose access immediately. Their history is kept.", action: "Remove member", run: () => client.removeMember(org.id, m.id) })}>
            {request ? "Request removal" : "Remove"}
          </Button>
        )}
      </>
    );
  };

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 id={`${id}-h`} className="type-heading text-ink">Members</h2>
          {org.myRole === "OWNER" && <p className="text-xs text-ink-muted">To transfer ownership, contact support.</p>}
        </div>
        {canManage && org.status === "VERIFIED" && <Button onClick={() => setInviting(true)}><UserPlus />Invite a member</Button>}
      </div>
      {list.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(list.error).title}</p>}
      {list.data && (
        <ul aria-label="Members" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {list.data.members.map((m) => (
            <li key={m.id} className="grid gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <Monogram name={m.publicDisplayName ?? "?"} />
                <div className="min-w-0 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-ink">{m.publicDisplayName ?? "No public name"}{m.isSelf && " (you)"}</span>
                    <span className="text-xs text-ink-muted">{MEMBERSHIP_ROLE_LABEL[m.role]}{m.customRole?.applies && ` · ${m.customRole.name}`}{m.requestedRole && ` · upgrade to ${MEMBERSHIP_ROLE_LABEL[m.requestedRole]} pending`}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} />
                    {m.verificationStatus && <StatusBadge {...MEMBER_VERIFICATION_STATUS_LABEL[m.verificationStatus]} label={`Verification: ${MEMBER_VERIFICATION_STATUS_LABEL[m.verificationStatus].label}`} />}
                  </div>
                  {m.status === "ACTIVE" && m.permissions.length > 0 && (
                    <p className="text-xs text-ink-faint">Can: {m.permissions.map((p) => PERMISSION_INFO[p].label.toLowerCase()).join(", ")}</p>
                  )}
                  {(m.invitedWallet || m.invitedEmail) && (
                    <p className="text-xs text-ink-muted">
                      {m.invitedWallet && <span className="font-mono">{CHAINS[m.invitedWallet.chain].label} · {shortAddress(m.invitedWallet.address)}</span>}
                      {m.invitedEmail && ` · ${m.invitedEmail}`}
                      {m.inviteExpiresAt && ` · expires ${new Date(m.inviteExpiresAt).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions(m)}</div>
            </li>
          ))}
        </ul>
      )}
      {actError && !confirm && actError}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent className="max-w-xl border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">Invite a member</DialogTitle>
            <DialogDescription>They join once they sign in with the wallet you name and accept.</DialogDescription>
          </DialogHeader>
          <InviteSteps roles={roles} client={client} orgId={org.id} onDone={(d) => { onSuccess(d); setInviting(false); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          {actError}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
            <Button variant="destructive" disabled={act.isPending} onClick={() => confirm && act.mutate(confirm.run)}>{confirm?.action}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Invitation in three steps: wallet, role, email and review. Nothing is sent before the last step. */
function InviteSteps({ roles, client, orgId, onDone }: { roles: MembershipRole[]; client: Client; orgId: string; onDone(d: ListMembersResponse): void }) {
  const id = useId();
  const [form, setForm] = useState({ walletChain: "ethereum", walletAddress: "", role: roles[0] ?? "VIEWER", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invite = useMutation({ mutationFn: (body: Parameters<Client["inviteOrganizationMember"]>[1]) => client.inviteOrganizationMember(orgId, body), onSuccess: onDone });
  const fieldError = (key: "walletAddress" | "email") => {
    const r = inviteMemberRequestSchema.safeParse(form);
    return r.success ? undefined : r.error.issues.find((i) => i.path[0] === key)?.message;
  };
  const checkStep = (key: "walletAddress" | "email") => { const e = fieldError(key); setErrors((p) => ({ ...p, [key]: e ?? "" })); return !e; };
  return (
    <StepForm label="Invite a member" submitLabel="Send invitation" pending={invite.isPending}
      onSubmit={() => { const r = inviteMemberRequestSchema.safeParse(form); if (r.success) invite.mutate(r.data); }}
      error={invite.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(invite.error).title}</span> {toDisplayError(invite.error).message}</p>}
      steps={[
        {
          id: "wallet", title: "Their wallet", description: "Typing an address does not link anyone. The invitee proves the wallet when they sign in.",
          validate: () => checkStep("walletAddress"),
          content: (
            <>
              <Field label="Wallet network" htmlFor={`${id}-chain`}>
                <Select id={`${id}-chain`} value={form.walletChain} onChange={(e) => setForm((f) => ({ ...f, walletChain: e.target.value }))}>
                  {signInChainSchema.options.map((c) => <option key={c} value={c}>{CHAINS[c].label}</option>)}
                </Select>
              </Field>
              <Field label="Wallet address" htmlFor={`${id}-address`} error={errors.walletAddress || undefined}>
                <Input id={`${id}-address`} value={form.walletAddress} autoComplete="off" spellCheck={false} aria-invalid={Boolean(errors.walletAddress)} className="font-mono"
                  onChange={(e) => setForm((f) => ({ ...f, walletAddress: e.target.value }))} />
              </Field>
            </>
          ),
        },
        {
          id: "role", title: "Their role", description: "You can fine-tune it later with a custom role.",
          content: (
            <div role="radiogroup" aria-label="Role" className="grid gap-2">
              {roles.map((r) => <ChoiceCard key={r} name={`${id}-role`} value={r} checked={form.role === r} onChange={(v) => setForm((f) => ({ ...f, role: v as MembershipRole }))} title={MEMBERSHIP_ROLE_LABEL[r]} description={ROLE_NOTE[r as Exclude<MembershipRole, "OWNER">]} />)}
            </div>
          ),
        },
        {
          id: "email", title: "Email and review", description: "The invitation is sent to this email; it is never shown publicly.",
          validate: () => checkStep("email"),
          content: (
            <>
              <Field label="Email for the invitation" htmlFor={`${id}-email`} error={errors.email || undefined}>
                <Input id={`${id}-email`} type="email" value={form.email} autoComplete="off" aria-invalid={Boolean(errors.email)} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Summary rows={[["Wallet", <span key="w" className="font-mono">{CHAINS[form.walletChain as keyof typeof CHAINS].label} · {form.walletAddress ? shortAddress(form.walletAddress) : "—"}</span>], ["Role", MEMBERSHIP_ROLE_LABEL[form.role]]]} />
            </>
          ),
        },
      ]} />
  );
}
