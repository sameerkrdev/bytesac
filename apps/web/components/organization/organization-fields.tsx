"use client";

import type { ApiClient } from "@repo/api-client";
import { ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, type OrganizationDetail, type OrganizationFieldKey, type VersionView } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "updateOrganizationDraft">;

/** Optional private catalog fields per type; template-required fields are always shown. */
const OPTIONAL_PRIVATE: Record<OrganizationDetail["type"], readonly string[]> = { individual: ["qualifications"], firm: ["businessAddress"] };
/** Everything not listed renders as a textarea. */
const INPUT_TYPE: Partial<Record<OrganizationFieldKey, string>> = {
  displayName: "text", website: "url", legalName: "text", legalCompanyName: "text", registrationNumber: "text", dateOfBirth: "date",
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function OrganizationFields({ org, version, readOnly, onChange, client = api }: { org: OrganizationDetail; version: VersionView; readOnly: boolean; onChange(org: OrganizationDetail): void; client?: Client }) {
  const id = useId();
  const initial: Record<string, unknown> = { ...version.publicProfile, ...version.privateDetails };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ORGANIZATION_FIELD_KEYS.map((k) => [k, text(initial[k])])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);

  const required = new Set(org.template.requiredFields);
  const shown = (visibility: "public" | "private") => ORGANIZATION_FIELD_KEYS.filter((k) =>
    ORGANIZATION_FIELDS[k].visibility === visibility && (visibility === "public" || required.has(k) || OPTIONAL_PRIVATE[org.type].includes(k)));

  async function save() {
    const body = { publicProfile: {} as Record<string, string | null>, privateDetails: {} as Record<string, string | null> };
    const errs: Record<string, string> = {};
    for (const k of ORGANIZATION_FIELD_KEYS) {
      const f = ORGANIZATION_FIELDS[k];
      const v = (values[k] ?? "").trim();
      // The API merges; null removes a key that had a value.
      if (v === "") {
        if (text(initial[k]) !== "") (f.visibility === "public" ? body.publicProfile : body.privateDetails)[k] = null;
        continue;
      }
      const r = f.schema.safeParse(v);
      if (!r.success) errs[k] = r.error.issues[0]?.message ?? "Invalid value";
      else (f.visibility === "public" ? body.publicProfile : body.privateDetails)[k] = v;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) { setError({ title: "Check your details", message: "Some fields need attention." }); return; }
    setPending(true);
    setError(null);
    try { onChange(await client.updateOrganizationDraft(org.id, body)); } catch (e) { setError(toDisplayError(e)); } finally { setPending(false); }
  }

  const section = (title: string, hint: string, visibility: "public" | "private") => (
    <section aria-labelledby={`${id}-${visibility}`} className="space-y-4">
      <div>
        <h3 id={`${id}-${visibility}`} className="font-display text-lg font-semibold text-ivory">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {shown(visibility).map((k) => {
        const fid = `${id}-${k}`;
        const common = { id: fid, value: values[k], "aria-invalid": Boolean(errors[k]), "aria-describedby": `${fid}-err`, onChange: (e: { target: { value: string } }) => setValues((p) => ({ ...p, [k]: e.target.value })) };
        return (
          <div key={k} className="space-y-2">
            <Label htmlFor={fid} className="text-xs font-medium text-ivory">{ORGANIZATION_FIELDS[k].label}{required.has(k) ? "" : " (optional)"}</Label>
            {INPUT_TYPE[k] ? <Input {...common} type={INPUT_TYPE[k]} className="min-h-11 bg-space text-ivory" /> : <Textarea {...common} />}
            {errors[k] && <p id={`${fid}-err`} className="text-xs text-danger">{errors[k]}</p>}
          </div>
        );
      })}
    </section>
  );

  return (
    <form noValidate className="space-y-8" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset disabled={readOnly} className="space-y-8">
        {section("Public profile", "Shown to investors once your organization is verified.", "public")}
        {section("Private details (never shown publicly)", "Only you and the Bytesac review team can see these.", "private")}
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
      {!readOnly && <Button type="submit" className="min-h-11" disabled={pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Save draft</Button>}
    </form>
  );
}
