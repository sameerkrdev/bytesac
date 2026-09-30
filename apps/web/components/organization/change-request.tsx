"use client";

import type { ApiClient } from "@repo/api-client";
import type { OrganizationDetail } from "@repo/validator";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "createOrganizationChangeRequest">;

/** Actions for a verified organization: view the public profile, start an edit (change request). */
export function ChangeRequest({ org, onChange, client = api }: { org: OrganizationDetail; onChange(org: OrganizationDetail): void; client?: Client }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try { onChange(await client.createOrganizationChangeRequest(org.id)); } catch (e) { setError(toDisplayError(e)); } finally { setPending(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/organizations/${org.id}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-mint underline"><ExternalLink aria-hidden className="size-4" />View public profile</Link>
        {!org.openVersion && (
          <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => void start()}>{pending && <Loader2 aria-hidden className="animate-spin" />}Edit profile</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
    </div>
  );
}
