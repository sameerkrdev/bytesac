"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL } from "@repo/app-core";
import { REVIEWED_ROLES } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";

type Client = Pick<ApiClient, "myInvitations" | "acceptInvitation" | "declineInvitation">;

export function Invitation({ mid, client = api }: { mid: string; client?: Client }) {
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["invitations"], queryFn: () => client.myInvitations(), retry: false });
  const done = () => { void qc.invalidateQueries({ queryKey: ["invitations"] }); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const accept = useMutation({
    mutationFn: () => client.acceptInvitation(mid),
    onSuccess: (m) => { done(); router.push(m.status === "ACTIVE" ? "/organization" : `/organization/membership/${mid}`); },
  });
  const decline = useMutation({ mutationFn: () => client.declineInvitation(mid), onSuccess: () => { done(); router.push("/home"); } });

  if (list.isError) return <p role="alert" className="text-sm text-danger">{toDisplayError(list.error).title}</p>;
  if (!list.data) return <LoadingState />;
  const invite = list.data.invitations.find((i) => i.membershipId === mid);
  const gone = accept.error instanceof ApiError && accept.error.code === "INVALID_TRANSITION";
  if (!invite || gone || new Date(invite.expiresAt) <= new Date()) {
    return (
      <section aria-labelledby="invite-title" className="max-w-xl space-y-4">
        <PageHeader id="invite-title" title="Invitation unavailable" />
        <p className="text-base text-ivory">This invitation has expired, was cancelled, or has already been answered. Ask the organization to invite you again.</p>
      </section>
    );
  }
  const error = accept.error ?? decline.error;
  const reviewed = (REVIEWED_ROLES as readonly string[]).includes(invite.role);
  return (
    <section aria-labelledby="invite-title" className="max-w-xl space-y-4">
      <PageHeader id="invite-title" title={`Join ${invite.organization.displayName ?? "an organization"}`} />
      <p className="text-base text-ivory">You have been invited as <span className="font-medium">{MEMBERSHIP_ROLE_LABEL[invite.role]}</span>.</p>
      {reviewed && <p role="note" className="rounded-xl border border-border-dark bg-slate p-4 text-sm text-ivory">You&apos;ll be asked to verify your identity before joining.</p>}
      <p className="text-sm text-stone">This invitation expires on {new Date(invite.expiresAt).toLocaleDateString()}.</p>
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{toDisplayError(error).title}</span> {toDisplayError(error).message}</p>}
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" disabled={accept.isPending || decline.isPending} onClick={() => accept.mutate()}>{accept.isPending && <Loader2 aria-hidden className="animate-spin" />}Accept invitation</Button>
        <Button variant="secondary" className="min-h-11" disabled={accept.isPending || decline.isPending} onClick={() => decline.mutate()}>Decline</Button>
      </div>
    </section>
  );
}
