"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL } from "@repo/app-core";
import { membershipProfileRequestSchema, REVIEWED_ROLES, type MyMembership } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { MemberVerification } from "./member-verification";

type Client = Pick<ApiClient, "getMembership" | "updateMembershipProfile" | "leaveOrganization">;

function ProfileForm({ m, client }: { m: MyMembership; client: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const [name, setName] = useState(m.publicDisplayName ?? "");
  const [title, setTitle] = useState(m.publicTitle ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Parameters<Client["updateMembershipProfile"]>[1]) => client.updateMembershipProfile(m.id, body),
    onSuccess: (d) => qc.setQueryData(["membership", m.id], d),
  });
  const error = save.isError && toDisplayError(save.error);
  return (
    <form noValidate className="space-y-4" aria-label="Public profile" onSubmit={(e) => {
      e.preventDefault();
      // null clears a value.
      const parsed = membershipProfileRequestSchema.safeParse({ publicDisplayName: name.trim() || null, publicTitle: title.trim() || null });
      if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? "Invalid value");
      setFieldError(null);
      save.mutate(parsed.data);
    }}>
      <div>
        <h2 className="font-display text-xl font-semibold text-ivory">Public profile</h2>
        <p className="text-xs text-muted-foreground">Optional. If you add a name, it is shown in the team list on the organization&apos;s public profile once you are active. Your wallet and email are never shown.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`} className="text-xs font-medium text-ivory">Public name</Label>
        <Input id={`${id}-name`} value={name} maxLength={80} aria-invalid={Boolean(fieldError)} className="min-h-11 bg-space text-ivory" onChange={(e) => setName(e.target.value)} />
        {fieldError && <p className="text-xs text-danger">{fieldError}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-title`} className="text-xs font-medium text-ivory">Title</Label>
        <Input id={`${id}-title`} value={title} maxLength={80} className="min-h-11 bg-space text-ivory" onChange={(e) => setTitle(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
      {save.isSuccess && <p role="status" className="text-xs text-success">Saved.</p>}
      <Button type="submit" className="min-h-11" disabled={save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save</Button>
    </form>
  );
}

export function MembershipPage({ mid, client = api }: { mid: string; client?: Client }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const query = useQuery({ queryKey: ["membership", mid], queryFn: () => client.getMembership(mid), retry: false });
  const leave = useMutation({
    mutationFn: () => client.leaveOrganization(mid),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["me"] }); router.push("/home"); },
  });

  if (query.isError) return <p role="alert" className="text-sm text-danger">{toDisplayError(query.error).title}</p>;
  const m = query.data;
  if (!m) return <LoadingState />;

  const open = m.status !== "REJECTED" && m.status !== "REVOKED";
  const reviewed = (REVIEWED_ROLES as readonly string[]).includes(m.requestedRole ?? m.role);
  const leaveError = leave.isError && toDisplayError(leave.error);
  return (
    <section aria-labelledby="membership-title" className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <PageHeader id="membership-title" title="Your membership" breadcrumb={[{ label: "Organization", href: "/organization" }]} />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} />
          <span className="text-sm text-stone">{MEMBERSHIP_ROLE_LABEL[m.role]}{m.requestedRole && ` · upgrade to ${MEMBERSHIP_ROLE_LABEL[m.requestedRole]} pending`}</span>
        </div>
        {m.status === "ACTIVE" && <Link href="/organization" className="inline-flex min-h-11 items-center text-sm text-mint underline">Go to the organization</Link>}
      </div>
      {open && <ProfileForm key={m.id} m={m} client={client} />}
      {open && reviewed && <MemberVerification mid={mid} />}
      {(m.status === "ACTIVE" || m.status === "REMOVAL_REQUESTED") && m.role !== "OWNER" && (
        <section aria-labelledby="leave-h" className="space-y-3">
          <h2 id="leave-h" className="font-display text-xl font-semibold text-ivory">Leave organization</h2>
          <p className="text-xs text-muted-foreground">You lose access immediately. The organization keeps the history of your membership.</p>
          <Button variant="destructive" className="min-h-11" onClick={() => setConfirm(true)}>Leave organization</Button>
        </section>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">Leave this organization?</DialogTitle>
            <DialogDescription>You lose access immediately. To rejoin you would need a new invitation.</DialogDescription>
          </DialogHeader>
          {leaveError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{leaveError.title}</span> {leaveError.message}</p>}
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setConfirm(false)}>Stay</Button>
            <Button variant="destructive" className="min-h-11" disabled={leave.isPending} onClick={() => leave.mutate()}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
