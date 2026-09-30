"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, MEMBER_VERIFICATION_STATUS_LABEL, shortAddress } from "@repo/app-core";
import { CHAINS, chainSchema, inviteMemberRequestSchema, type ListMembersResponse, type MemberView, type MembershipRole, type OrganizationDetail } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "listOrganizationMembers" | "inviteOrganizationMember" | "cancelMemberInvite" | "changeMemberRole" | "removeMember" | "confirmMemberRemoval" | "cancelMemberRemoval">;
type Confirm = { title: string; description: string; action: string; run(): Promise<ListMembersResponse> };

const ASSIGNABLE: MembershipRole[] = ["ADMIN", "MANAGER", "ANALYST", "VIEWER"];
const OPEN_INVITE = ["PENDING_WALLET_VERIFICATION", "INVITED"];

export function Members({ org, client = api }: { org: OrganizationDetail; client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const key = ["organization", org.id, "members"];
  const can = (p: OrganizationDetail["myPermissions"][number]) => org.myPermissions.includes(p);
  const canManage = can("members.manage");
  const canManageAdmins = can("members.manage_admins");
  const roles = ASSIGNABLE.filter((r) => r !== "ADMIN" || canManageAdmins);
  const list = useQuery({ queryKey: key, queryFn: () => client.listOrganizationMembers(org.id), retry: false });
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [form, setForm] = useState({ walletChain: "ethereum", walletAddress: "", role: roles[0] ?? "VIEWER", email: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const onSuccess = (d: ListMembersResponse) => { qc.setQueryData(key, d); setConfirm(null); };
  const act = useMutation({ mutationFn: (run: () => Promise<ListMembersResponse>) => run(), onSuccess });
  const invite = useMutation({
    mutationFn: (body: Parameters<Client["inviteOrganizationMember"]>[1]) => client.inviteOrganizationMember(org.id, body),
    onSuccess: (d) => { onSuccess(d); setForm((f) => ({ ...f, walletAddress: "", email: "" })); },
  });

  function submitInvite() {
    const parsed = inviteMemberRequestSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setFieldErrors(errs);
    }
    setFieldErrors({});
    invite.mutate(parsed.data);
  }

  const actError = act.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(act.error).title}</span> {toDisplayError(act.error).message}</p>;
  // A member's row is actionable by the caller only per the matrix: ADMIN rows need members.manage_admins, except that an ADMIN may request an ADMIN's removal.
  const actionable = (m: MemberView) => canManage && !m.isSelf && m.role !== "OWNER" && (m.role !== "ADMIN" || canManageAdmins);
  const who = (m: MemberView) => m.publicDisplayName ?? "this member";

  const actions = (m: MemberView) => {
    if (m.status === "REMOVAL_REQUESTED" && canManageAdmins) {
      return (
        <>
          <Button variant="destructive" className="min-h-11" onClick={() => setConfirm({ title: "Remove this admin?", description: "An admin asked to remove this member. They lose access immediately. Their history is kept.", action: "Confirm removal", run: () => client.confirmMemberRemoval(org.id, m.id) })}>Confirm removal</Button>
          <Button variant="secondary" className="min-h-11" onClick={() => act.mutate(() => client.cancelMemberRemoval(org.id, m.id))}>Cancel request</Button>
        </>
      );
    }
    if (OPEN_INVITE.includes(m.status) && canManage && (m.role !== "ADMIN" || canManageAdmins)) {
      return <Button variant="secondary" className="min-h-11" onClick={() => setConfirm({ title: "Cancel this invitation?", description: "The invitation can no longer be accepted.", action: "Cancel invitation", run: () => client.cancelMemberInvite(org.id, m.id) })}>Cancel invite</Button>;
    }
    if (m.status !== "ACTIVE") return null;
    const request = m.role === "ADMIN" && !canManageAdmins;
    return (
      <>
        {actionable(m) && (
          <>
            <Label htmlFor={`${id}-role-${m.id}`} className="sr-only">Role for {who(m)}</Label>
            <Select id={`${id}-role-${m.id}`} className="w-auto" value={m.role} onChange={(e) => { const role = e.target.value as Exclude<MembershipRole, "OWNER">; act.mutate(() => client.changeMemberRole(org.id, m.id, { role })); }}>
              {[...new Set([m.role, ...roles])].map((r) => <option key={r} value={r}>{MEMBERSHIP_ROLE_LABEL[r]}</option>)}
            </Select>
          </>
        )}
        {canManage && !m.isSelf && m.role !== "OWNER" && (
          <Button variant="destructive" className="min-h-11" onClick={() => setConfirm(request
            ? { title: "Request removal of this admin?", description: "Only the owner can remove an admin. They will be asked to confirm.", action: "Request removal", run: () => client.removeMember(org.id, m.id) }
            : { title: "Remove this member?", description: "They lose access immediately. Their history is kept.", action: "Remove member", run: () => client.removeMember(org.id, m.id) })}>
            {request ? "Request removal" : "Remove"}
          </Button>
        )}
      </>
    );
  };

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h3 id={`${id}-h`} className="font-display text-lg font-semibold text-ivory">Members</h3>
      {org.myRole === "OWNER" && <p className="text-xs text-muted-foreground">To transfer ownership, contact support.</p>}
      {list.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(list.error).title}</p>}
      {list.data && (
        <ul aria-label="Members" className="divide-y divide-border-dark">
          {list.data.members.map((m) => (
            <li key={m.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-ivory">{m.publicDisplayName ?? "No public name"}{m.isSelf && " (you)"}</span>
                <span className="text-xs text-stone">{MEMBERSHIP_ROLE_LABEL[m.role]}{m.requestedRole && ` · upgrade to ${MEMBERSHIP_ROLE_LABEL[m.requestedRole]} pending`}</span>
                <StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} />
                {m.verificationStatus && <StatusBadge {...MEMBER_VERIFICATION_STATUS_LABEL[m.verificationStatus]} label={`Verification: ${MEMBER_VERIFICATION_STATUS_LABEL[m.verificationStatus].label}`} />}
              </div>
              {(m.invitedWallet || m.invitedEmail) && (
                <p className="text-xs text-stone">
                  {m.invitedWallet && <span className="font-mono">{CHAINS[m.invitedWallet.chain].label} · {shortAddress(m.invitedWallet.address)}</span>}
                  {m.invitedEmail && ` · ${m.invitedEmail}`}
                  {m.inviteExpiresAt && ` · expires ${new Date(m.inviteExpiresAt).toLocaleDateString()}`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">{actions(m)}</div>
            </li>
          ))}
        </ul>
      )}
      {actError && !confirm && actError}

      {canManage && (
        <form noValidate className="space-y-3 rounded-xl border border-border-dark p-4" aria-label="Invite a member" onSubmit={(e) => { e.preventDefault(); submitInvite(); }}>
          <h4 className="text-sm font-medium text-ivory">Invite a member</h4>
          <div className="space-y-2">
            <Label htmlFor={`${id}-chain`} className="text-xs font-medium text-ivory">Wallet network</Label>
            <Select id={`${id}-chain`} value={form.walletChain} onChange={(e) => setForm((f) => ({ ...f, walletChain: e.target.value }))}>
              {chainSchema.options.map((c) => <option key={c} value={c}>{CHAINS[c].label}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-address`} className="text-xs font-medium text-ivory">Wallet address</Label>
            <Input id={`${id}-address`} value={form.walletAddress} autoComplete="off" spellCheck={false} aria-invalid={Boolean(fieldErrors.walletAddress)} className="min-h-11 bg-space font-mono text-ivory"
              onChange={(e) => setForm((f) => ({ ...f, walletAddress: e.target.value }))} />
            {fieldErrors.walletAddress && <p className="text-xs text-danger">{fieldErrors.walletAddress}</p>}
            <p className="text-xs text-muted-foreground">Typing an address does not link anyone. The invitee proves the wallet when they sign in.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-role`} className="text-xs font-medium text-ivory">Role</Label>
            <Select id={`${id}-role`} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as MembershipRole }))}>
              {roles.map((r) => <option key={r} value={r}>{MEMBERSHIP_ROLE_LABEL[r]}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-email`} className="text-xs font-medium text-ivory">Email for the invitation</Label>
            <Input id={`${id}-email`} type="email" value={form.email} autoComplete="off" aria-invalid={Boolean(fieldErrors.email)} className="min-h-11 bg-space text-ivory"
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            {fieldErrors.email && <p className="text-xs text-danger">{fieldErrors.email}</p>}
          </div>
          {invite.isError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(invite.error).title}</span> {toDisplayError(invite.error).message}</p>}
          <Button type="submit" className="min-h-11" disabled={invite.isPending}>{invite.isPending && <Loader2 aria-hidden className="animate-spin" />}Send invitation</Button>
        </form>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          {actError}
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirm(null)}>Keep</Button>
            <Button variant="destructive" className="min-h-11" disabled={act.isPending} onClick={() => confirm && act.mutate(confirm.run)}>{confirm?.action}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
