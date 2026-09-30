"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { MEMBER_VERIFICATION_STATUS_LABEL } from "@repo/app-core";
import { ORGANIZATION_DOCUMENT_TYPES, ORGANIZATION_FIELDS, type DocumentTypeKey, type MemberVerificationView, type OrganizationFieldKey } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "getMemberVerification" | "updateMemberVerification" | "presignMemberDocument" | "confirmMemberDocument" | "unlinkMemberDocument" | "submitMemberVerification">;

/** The member's own verification: the Spec 3 fields/documents components pointed at the member endpoints. */
export function MemberVerification({ mid, client = api }: { mid: string; client?: Client }) {
  const qc = useQueryClient();
  const key = ["membership", mid, "verification"];
  const query = useQuery({ queryKey: key, queryFn: () => client.getMemberVerification(mid), retry: false });
  const set = (v: MemberVerificationView) => { qc.setQueryData(key, v); void qc.invalidateQueries({ queryKey: ["membership", mid], exact: true }); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const submit = useMutation({
    mutationFn: () => client.submitMemberVerification(mid),
    onSuccess: set,
    onError: (e) => { if (e instanceof ApiError && e.code === "REQUIREMENTS_INCOMPLETE") void qc.invalidateQueries({ queryKey: key }); },
  });

  // No verification row (or no access): nothing to show.
  const v = query.data;
  if (!v) return null;

  const editable = v.status === "draft" || v.status === "changes_required";
  const items = [
    ...v.missing.fields.map((k) => `Fill in: ${ORGANIZATION_FIELDS[k as OrganizationFieldKey]?.label ?? k}`),
    ...v.missing.documents.map((k) => `Upload: ${ORGANIZATION_DOCUMENT_TYPES[k as DocumentTypeKey]?.label ?? k}`),
  ];
  const error = submit.isError && toDisplayError(submit.error);
  return (
    <section aria-labelledby="verification-h" className="space-y-6">
      <div className="space-y-2">
        <h2 id="verification-h" className="font-display text-xl font-semibold text-ivory">Identity verification</h2>
        <StatusBadge {...MEMBER_VERIFICATION_STATUS_LABEL[v.status]} />
        <p className="text-xs text-muted-foreground">Only you and the Bytesac review team can see this. The organization sees only whether you are verified.</p>
      </div>
      {v.status === "changes_required" && v.latestMessageToMember && (
        <div role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
          <p className="font-medium text-warning">Changes required</p>
          <p className="mt-1 whitespace-pre-wrap">{v.latestMessageToMember}</p>
        </div>
      )}
      <OrganizationFields key={v.status} org={{ id: mid, type: "member", template: v.template }} version={{ publicProfile: {}, privateDetails: v.details }} readOnly={!editable} onChange={set}
        client={{ updateOrganizationDraft: (id, body) => client.updateMemberVerification(id, { details: body.privateDetails }) }} />
      <OrganizationDocuments org={{ id: mid, template: v.template }} version={v} readOnly={!editable} optional={[]} onChange={set}
        client={{ presignOrganizationDocument: client.presignMemberDocument, confirmOrganizationDocument: client.confirmMemberDocument, unlinkOrganizationDocument: client.unlinkMemberDocument }} />
      {editable && (
        <section aria-labelledby="member-submit-h" className="space-y-3">
          <h3 id="member-submit-h" className="font-display text-lg font-semibold text-ivory">Submit for review</h3>
          {items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ivory"><CheckCircle2 aria-hidden className="size-4 text-success" />Everything required is complete.</p>
          ) : (
            <ul aria-label="Still to do" className="space-y-1">
              {items.map((i) => <li key={i} className="flex items-center gap-2 text-sm text-ivory"><Circle aria-hidden className="size-4 text-warning" />{i}</li>)}
            </ul>
          )}
          {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
          <Button className="min-h-11" disabled={items.length > 0 || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending && <Loader2 aria-hidden className="animate-spin" />}{v.status === "changes_required" ? "Resubmit" : "Submit for review"}
          </Button>
        </section>
      )}
    </section>
  );
}
