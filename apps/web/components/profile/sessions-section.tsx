"use client";
import { ApiError, describeError } from "@repo/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";

function errorText(e: unknown): string {
  return describeError(e instanceof ApiError ? e.code : "INTERNAL").title;
}

export function SessionsSection() {
  const qc = useQueryClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const { data, isError } = useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  const all = useMutation({ mutationFn: () => api.logoutAll(), onSuccess: () => { qc.clear(); router.replace("/sign-in"); } });

  return (
    <section aria-labelledby="sessions-title" className="space-y-4 rounded-2xl border border-border-dark bg-slate p-6">
      <div className="flex items-center justify-between">
        <h2 id="sessions-title" className="font-display text-xl font-semibold text-ivory">Sessions</h2>
        <Button variant="destructive" className="min-h-11" onClick={() => setConfirm(true)}>Log out all devices</Button>
      </div>
      {isError && <p role="alert" className="text-sm text-danger">Couldn't load sessions. Refresh to try again.</p>}
      {revoke.isError && <p role="alert" className="text-sm text-danger">{errorText(revoke.error)}</p>}
      {all.isError && <p role="alert" className="text-sm text-danger">{errorText(all.error)}</p>}
      {data && data.sessions.length === 0 && <p className="text-sm text-stone">No active sessions.</p>}
      <ul className="divide-y divide-border-dark">
        {data?.sessions.map((s) => {
          const Icon = s.client === "mobile" ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <Icon aria-hidden className="size-4 text-stone" />
              <span className="text-ivory">{s.client === "mobile" ? "Mobile app" : "Web"}</span>
              <span className="max-w-xs truncate text-xs text-stone" title={s.userAgent ?? undefined}>{s.userAgent ?? "Unknown device"}</span>
              <span className="text-xs text-stone">{s.ipPrefix ?? ""} · last seen {formatRelative(s.lastSeenAt)}</span>
              {s.current ? <StatusBadge tone="success" label="This device" /> : (
                <Button variant="ghost" className="ml-auto min-h-11" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>Revoke</Button>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">Log out of all devices?</DialogTitle>
            <DialogDescription>Every session, including this one, ends. You'll sign in with your wallet again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" className="min-h-11" disabled={all.isPending} onClick={() => all.mutate()}>Log out everywhere</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
