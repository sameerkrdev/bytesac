"use client";

import { ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, type OrganizationDetail, type OrganizationFieldKey } from "@repo/validator";
import { Eye, Lock } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Field, StepForm, type Step } from "@/components/ui/step-form";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Body = { publicProfile: Record<string, string | null>; privateDetails: Record<string, string | null> };
type Client<T> = { updateOrganizationDraft(id: string, body: Body): Promise<T> };
type Visibility = "public" | "private";

/** Optional private catalog fields per type; template-required fields are always shown. A member verification (type "member") has private fields only. */
const OPTIONAL_PRIVATE: Record<OrganizationDetail["type"] | "member", readonly string[]> = { individual: ["qualifications"], firm: ["businessAddress"], member: [] };
/** Everything not listed renders as a textarea. */
const INPUT_TYPE: Partial<Record<OrganizationFieldKey, string>> = {
  displayName: "text", website: "url", legalName: "text", legalCompanyName: "text", registrationNumber: "text", dateOfBirth: "date",
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * The organization (or member verification) details as short steps: public profile, private details, then a review
 * before saving the draft. Each step checks only its own fields. Read-only viewers get a plain summary.
 */
export function OrganizationFields<T = OrganizationDetail>({ org, version, readOnly, onChange, client = api as unknown as Client<T> }: {
  org: { id: string; type: OrganizationDetail["type"] | "member"; template: { requiredFields: string[] } };
  version: { publicProfile: Record<string, unknown>; privateDetails: Record<string, unknown> };
  readOnly: boolean; onChange(saved: T): void; client?: Client<T>;
}) {
  const id = useId();
  const initial: Record<string, unknown> = { ...version.publicProfile, ...version.privateDetails };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ORGANIZATION_FIELD_KEYS.map((k) => [k, text(initial[k])])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);

  const required = new Set(org.template.requiredFields);
  const shown = (visibility: Visibility) => ORGANIZATION_FIELD_KEYS.filter((k) =>
    ORGANIZATION_FIELDS[k].visibility === visibility && (visibility === "public" || required.has(k) || OPTIONAL_PRIVATE[org.type].includes(k)));
  const label = (k: OrganizationFieldKey) => `${ORGANIZATION_FIELDS[k].label}${required.has(k) ? "" : " (optional)"}`;

  /** Checks the given fields' format (completeness is checked at submit, server-side); returns whether they pass. */
  function check(keys: readonly OrganizationFieldKey[]): boolean {
    const next = { ...errors };
    for (const k of keys) {
      const v = (values[k] ?? "").trim();
      const r = v === "" ? null : ORGANIZATION_FIELDS[k].schema.safeParse(v);
      if (r && !r.success) next[k] = r.error.issues[0]?.message ?? "Invalid value"; else delete next[k];
    }
    setErrors(next);
    return keys.every((k) => !next[k]);
  }

  async function save() {
    if (!check(ORGANIZATION_FIELD_KEYS)) { setError({ title: "Check your details", message: "Some fields need attention." }); return; }
    const body: Body = { publicProfile: {}, privateDetails: {} };
    for (const k of ORGANIZATION_FIELD_KEYS) {
      const f = ORGANIZATION_FIELDS[k];
      const v = (values[k] ?? "").trim();
      // The API merges; null removes a key that had a value.
      if (v === "") { if (text(initial[k]) !== "") (f.visibility === "public" ? body.publicProfile : body.privateDetails)[k] = null; continue; }
      (f.visibility === "public" ? body.publicProfile : body.privateDetails)[k] = v;
    }
    setPending(true);
    setError(null);
    try { onChange(await client.updateOrganizationDraft(org.id, body)); } catch (e) { setError(toDisplayError(e)); } finally { setPending(false); }
  }

  const fields = (visibility: Visibility) => shown(visibility).map((k) => {
    const fid = `${id}-${k}`;
    const common = { id: fid, value: values[k], "aria-invalid": Boolean(errors[k]), "aria-describedby": errors[k] ? `${fid}-error` : undefined, onChange: (e: { target: { value: string } }) => setValues((p) => ({ ...p, [k]: e.target.value })) };
    return (
      <Field key={k} label={label(k)} htmlFor={fid} error={errors[k]}>
        {INPUT_TYPE[k] ? <Input {...common} type={INPUT_TYPE[k]} /> : <Textarea {...common} rows={4} />}
      </Field>
    );
  });

  const summary = (visibility: Visibility) => (
    <section aria-labelledby={`${id}-${visibility}-sum`} className="rounded-tile border border-line bg-surface p-5">
      <h4 id={`${id}-${visibility}-sum`} className="flex items-center gap-2 text-sm font-medium text-ink">
        {visibility === "public" ? <Eye aria-hidden className="size-4 text-ink-faint" /> : <Lock aria-hidden className="size-4 text-ink-faint" />}
        {visibility === "public" ? "Public profile" : "Private details (never shown publicly)"}
      </h4>
      <dl className="mt-3 divide-y divide-line">
        {shown(visibility).map((k) => (
          <div key={k} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-ink-muted">{ORGANIZATION_FIELDS[k].label}</dt>
            <dd className="whitespace-pre-wrap break-words text-ink">{(values[k] ?? "").trim() || <span className="text-ink-faint">{required.has(k) ? "Missing" : "—"}</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

  if (readOnly) {
    return <div className="space-y-4">{org.type !== "member" && summary("public")}{summary("private")}</div>;
  }

  const steps: Step[] = [
    ...(org.type !== "member" ? [{
      id: "public", title: "Public profile", description: "Shown to investors once your organization is verified.",
      content: fields("public"), validate: () => check(shown("public")),
    }] : []),
    { id: "private", title: "Private details (never shown publicly)", description: "Only you and the Bytesac review team can see these.", content: fields("private"), validate: () => check(shown("private")) },
    {
      id: "review", title: "Review and save", description: "Saving keeps this as a draft. Nothing is sent for review until you submit.",
      content: <div className="space-y-4">{org.type !== "member" && summary("public")}{summary("private")}</div>,
    },
  ];

  return (
    <StepForm label="Organization details" steps={steps} submitLabel="Save draft" pending={pending} onSubmit={() => void save()}
      error={error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>} />
  );
}
