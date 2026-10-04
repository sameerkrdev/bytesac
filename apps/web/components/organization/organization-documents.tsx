"use client";

import { ApiError } from "@repo/api-client";
import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES, ORGANIZATION_DOCUMENT_TYPES, type DocumentContentType, type DocumentTypeKey, type DocumentView, type OrganizationDetail, type PresignDocumentRequest, type PresignDocumentResponse } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

/** Organization endpoints by default; member verification passes the member endpoints (same shapes, `id` is the membership id). */
type Client<T> = {
  presignOrganizationDocument(id: string, body: PresignDocumentRequest): Promise<PresignDocumentResponse>;
  confirmOrganizationDocument(id: string, docId: string): Promise<T>;
  unlinkOrganizationDocument(id: string, docId: string): Promise<T>;
};
type Scope = { id: string; template: { requiredDocuments: string[] } };
type Row = { state: "idle" } | { state: "uploading" } | { state: "rejected"; message: string };

function DocumentRow<T>({ org, version, type, readOnly, required, onChange, client }: {
  org: Scope; version: { documents: DocumentView[] }; type: DocumentTypeKey; readOnly: boolean; required: boolean; onChange(saved: T): void; client: Client<T>;
}) {
  const id = useId();
  const [row, setRow] = useState<Row>({ state: "idle" });
  const doc = version.documents.find((d) => d.documentType === type && d.status === "uploaded");

  async function upload(file: File) {
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) return setRow({ state: "rejected", message: "Upload a PDF, JPEG or PNG file." });
    if (file.size < 1 || file.size > MAX_DOCUMENT_BYTES) return setRow({ state: "rejected", message: "The file must be 10 MB or smaller." });
    setRow({ state: "uploading" });
    try {
      const { documentId, uploadUrl, headers } = await client.presignOrganizationDocument(org.id, { documentType: type, contentType: file.type as DocumentContentType, sizeBytes: file.size });
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers });
      if (!put.ok) throw new Error("Upload failed");
      onChange(await client.confirmOrganizationDocument(org.id, documentId));
      setRow({ state: "idle" });
    } catch (e) {
      setRow({ state: "rejected", message: e instanceof ApiError ? toDisplayError(e).title : "The upload didn't complete. Try again." });
    }
  }

  async function remove(docId: string) {
    try { onChange(await client.unlinkOrganizationDocument(org.id, docId)); } catch (e) { setRow({ state: "rejected", message: toDisplayError(e).title }); }
  }

  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-ink">{ORGANIZATION_DOCUMENT_TYPES[type].label}{required ? "" : " (optional)"}</span>
        {doc && <StatusBadge tone="success" label="Uploaded" />}
        {row.state === "uploading" && <span role="status" className="inline-flex items-center gap-1 text-xs text-ink-muted"><Loader2 aria-hidden className="size-3.5 animate-spin" />Uploading…</span>}
        {row.state === "rejected" && <StatusBadge tone="danger" label="Not accepted" />}
      </div>
      {doc && <p className="text-xs text-ink-muted">{doc.contentType} · {(doc.sizeBytes / 1024).toFixed(0)} KB{doc.uploadedAt && ` · ${new Date(doc.uploadedAt).toLocaleDateString()}`}</p>}
      {row.state === "rejected" && <p role="alert" className="text-xs text-danger">{row.message}</p>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={id} className="sr-only">{doc ? `Replace ${ORGANIZATION_DOCUMENT_TYPES[type].label}` : `Choose file for ${ORGANIZATION_DOCUMENT_TYPES[type].label}`}</label>
          <input id={id} type="file" accept={DOCUMENT_CONTENT_TYPES.join(",")} disabled={row.state === "uploading"} className="min-h-11 text-sm text-ink-muted file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:text-ink"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          {doc && <Button variant="ghost"  onClick={() => void remove(doc.id)}>Remove from draft</Button>}
        </div>
      )}
    </li>
  );
}

export function OrganizationDocuments<T = OrganizationDetail>({ org, version, readOnly, onChange, client = api as unknown as Client<T>, optional = ["license_registration"] }: {
  org: Scope; version: { documents: DocumentView[] }; readOnly: boolean; onChange(saved: T): void; client?: Client<T>; optional?: DocumentTypeKey[];
}) {
  const required = org.template.requiredDocuments as DocumentTypeKey[];
  const types = [...required, ...optional.filter((t) => !required.includes(t))];
  return (
    <section aria-labelledby="documents-h" className="space-y-2">
      <h3 id="documents-h" className="text-lg font-medium tracking-tight text-ink">Documents</h3>
      <p className="text-xs text-ink-muted">PDF, JPEG or PNG, up to 10 MB. Documents stay private: only you and the Bytesac review team can see them.</p>
      <ul className="divide-y divide-line">
        {types.map((t) => <DocumentRow key={t} org={org} version={version} type={t} readOnly={readOnly} required={required.includes(t)} onChange={onChange} client={client} />)}
      </ul>
    </section>
  );
}
