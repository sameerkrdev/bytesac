"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { ORGANIZATION_DOCUMENT_TYPES, ORGANIZATION_FIELDS, type DocumentTypeKey, type OrganizationDetail, type OrganizationFieldKey } from "@repo/validator";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "submitOrganization" | "submitOrganizationChangeRequest">;

export function SubmitChecklist({ org, onChange, onIncomplete, client = api }: { org: OrganizationDetail; onChange(org: OrganizationDetail): void; onIncomplete(): void; client?: Client }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const missing = org.missing ?? { fields: [], documents: [], payoutWallet: false };
  const items = [
    ...missing.fields.map((k) => `Fill in: ${ORGANIZATION_FIELDS[k as OrganizationFieldKey]?.label ?? k}`),
    ...missing.documents.map((k) => `Upload: ${ORGANIZATION_DOCUMENT_TYPES[k as DocumentTypeKey]?.label ?? k}`),
    ...(missing.payoutWallet ? ["Verify your payout wallet"] : []),
  ];
  const verified = org.status === "VERIFIED";
  const label = verified ? "Submit changes for review" : org.status === "CHANGES_REQUIRED" ? "Resubmit" : "Submit for review";

  async function submit() {
    setPending(true);
    setError(null);
    try { onChange(await (verified ? client.submitOrganizationChangeRequest(org.id) : client.submitOrganization(org.id))); } catch (e) {
      setError(toDisplayError(e));
      if (e instanceof ApiError && e.code === "REQUIREMENTS_INCOMPLETE") onIncomplete();
    } finally { setPending(false); }
  }

  return (
    <section aria-labelledby="submit-h" className="space-y-3">
      <h3 id="submit-h" className="text-lg font-medium tracking-tight text-ink">Submit for review</h3>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 aria-hidden className="size-4 text-success" />Everything required is complete.</p>
      ) : (
        <ul aria-label="Still to do" className="space-y-1">
          {items.map((i) => <li key={i} className="flex items-center gap-2 text-sm text-ink"><Circle aria-hidden className="size-4 text-warning" />{i}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
      <Button  disabled={items.length > 0 || pending} onClick={() => void submit()}>{pending && <Loader2 aria-hidden className="animate-spin" />}{label}</Button>
    </section>
  );
}
