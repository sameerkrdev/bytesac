"use client";

import type { ApiClient } from "@repo/api-client";
import { APPLICATION_STATUS_LABEL } from "@repo/app-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { LoadingState } from "@/components/layout/states";

type Client = Pick<ApiClient, "getApplicationStatus" | "replyToApplication">;

export function StatusView({ client = api }: { client?: Client }) {
  const replyId = useId();
  // The token lives in the URL fragment so it never reaches servers or logs; read it after mount.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(window.location.hash.slice(1) || null), []);
  const [message, setMessage] = useState("");

  const status = useQuery({
    queryKey: ["application-status", token],
    queryFn: () => client.getApplicationStatus(token as string),
    enabled: Boolean(token),
    retry: false,
  });
  const reply = useMutation({
    mutationFn: () => client.replyToApplication(token as string, message.trim()),
    onSuccess: () => { setMessage(""); void status.refetch(); },
  });

  if (token === undefined || (token && status.isPending)) return <LoadingState />;
  const s = status.data;
  if (!token || !s) {
    const e = token ? toDisplayError(status.error) : { title: "Status link not valid", message: "Open the private link from your confirmation email." };
    return <p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p>;
  }

  const badge = APPLICATION_STATUS_LABEL[s.status];
  const replyError = reply.isError ? toDisplayError(reply.error) : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={badge.tone} label={badge.label} />
        {s.submittedAt && <span className="text-sm text-ink-muted">Submitted {new Date(s.submittedAt).toLocaleDateString()}</span>}
      </div>
      <p className="text-sm text-ink-muted">Application for <span className="text-ink">{s.fullName}</span> ({s.applicantType})</p>
      {s.latestMessage && (
        <div className="space-y-1 rounded-tile border border-line bg-canvas p-4">
          <p className="text-xs font-medium text-ink-muted">Message from the Bytesac team</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{s.latestMessage}</p>
        </div>
      )}
      {s.canReply && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
          <Label htmlFor={replyId} className="text-xs font-medium text-ink">Your reply</Label>
          <Textarea id={replyId} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} />
          {replyError && <p role="alert" className="text-sm text-danger"><span className="font-medium">{replyError.title}</span> {replyError.message}</p>}
          <Button type="submit"  disabled={!message.trim() || reply.isPending}>
            {reply.isPending && <Loader2 aria-hidden className="animate-spin" />}Send reply
          </Button>
        </form>
      )}
      {reply.isSuccess && !s.canReply && <p role="status" className="text-sm text-success">Reply sent. We&apos;ll be in touch.</p>}
    </div>
  );
}
