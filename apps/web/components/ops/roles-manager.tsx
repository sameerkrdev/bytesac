"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { grantRoleRequestSchema, platformRoleSchema, type PlatformRoleView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListRoles" | "opsGrantRole" | "opsRevokeRole">;

export function RolesManager({ client = api }: { client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<string>("ops_reviewer");
  const [invalid, setInvalid] = useState(false);
  const [revoking, setRevoking] = useState<PlatformRoleView | null>(null);
  const isAdmin = me?.platformRoles.includes("ops_admin");

  const roles = useQuery({ queryKey: ["ops", "roles"], queryFn: () => client.opsListRoles(), enabled: isAdmin, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops", "roles"] });
  const grant = useMutation({ mutationFn: (b: Parameters<Client["opsGrantRole"]>[0]) => client.opsGrantRole(b), onSuccess: () => { setUserId(""); return refresh(); } });
  const revoke = useMutation({ mutationFn: (rid: string) => client.opsRevokeRole(rid), onSuccess: () => { setRevoking(null); return refresh(); } });

  if (!isAdmin) return <p role="alert" className="text-base text-ink">You don&apos;t have access to this area.</p>;
  // The server's message ("At least one ops admin must remain.") is the useful text for the last-admin refusal.
  const revokeError = revoke.error instanceof ApiError && revoke.error.code === "INVALID_TRANSITION"
    ? <p role="alert" className="text-sm text-danger">{revoke.error.message}</p>
    : revoke.isError && <OpsError error={revoke.error} />;

  return (
    <div className="space-y-8">
      <PageHeader title="Roles" />

      <form className="grid max-w-xl gap-4" onSubmit={(e) => {
        e.preventDefault();
        const parsed = grantRoleRequestSchema.safeParse({ userId: userId.trim(), role });
        setInvalid(!parsed.success);
        if (parsed.success) grant.mutate(parsed.data);
      }}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-user`} className="text-xs font-medium text-ink">User ID</Label>
          <Input id={`${id}-user`} value={userId} aria-invalid={invalid} autoComplete="off" spellCheck={false} onChange={(e) => setUserId(e.target.value)} className="min-h-11 bg-canvas font-mono text-ink" />
          {invalid && <p className="text-xs text-danger">Enter a valid user ID (UUID).</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-role`} className="text-xs font-medium text-ink">Role</Label>
          <Select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value)}>
            {platformRoleSchema.options.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <Button type="submit" className="min-h-11 w-fit" disabled={grant.isPending}>Grant role</Button>
        {grant.isError && <OpsError error={grant.error} />}
      </form>

      {roles.isError ? <OpsError error={roles.error} onRetry={() => void roles.refetch()} /> : !roles.data ? <LoadingState /> : (
        <ul className="space-y-3">
          {roles.data.roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-tile border border-line bg-surface p-3">
              <span className="break-all font-mono text-xs text-ink-muted">{r.userId}</span>
              <span className="text-sm font-medium text-ink">{r.role}</span>
              <span className="text-xs text-ink-muted">since {new Date(r.grantedAt).toLocaleDateString()}</span>
              <Button variant="ghost" className="ml-auto min-h-11" aria-label={`Revoke ${r.role} from ${r.userId}`} onClick={() => { revoke.reset(); setRevoking(r); }}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke role?</DialogTitle>
            <DialogDescription>{revoking?.role} will be removed from user {revoking?.userId}. This takes effect on their next request.</DialogDescription>
          </DialogHeader>
          {revokeError}
          <DialogFooter>
            <Button variant="destructive"  disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>Confirm revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
