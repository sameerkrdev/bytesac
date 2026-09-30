"use client";

import type { ApiClient } from "@repo/api-client";
import { createOrganizationRequestSchema, type OrganizationDetail } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "createOrganization">;

export function CreateOrganization({ onCreated, client = api }: { onCreated(org: OrganizationDetail): void; client?: Client }) {
  const id = useId();
  const [type, setType] = useState("individual");
  const [jurisdiction, setJurisdiction] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    const parsed = createOrganizationRequestSchema.safeParse({ type, jurisdiction });
    setFieldError(parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === "jurisdiction")?.message ?? null));
    if (!parsed.success) return;
    setPending(true);
    setError(null);
    try { onCreated(await client.createOrganization(parsed.data)); } catch (e) { setError(toDisplayError(e)); } finally { setPending(false); }
  }

  return (
    <form noValidate className="max-w-xl space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ivory">Organization type</legend>
        {(["individual", "firm"] as const).map((t) => (
          <label key={t} className="flex min-h-11 items-center gap-3 text-sm text-ivory">
            <input type="radio" name={`${id}-type`} value={t} checked={type === t} onChange={() => setType(t)} className="size-4 accent-mint" />
            {t === "individual" ? "Individual manager" : "Firm"}
          </label>
        ))}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor={`${id}-j`} className="text-xs font-medium text-ivory">Country of registration or residence</Label>
        <Input id={`${id}-j`} value={jurisdiction} maxLength={2} placeholder="IN" autoComplete="country" aria-invalid={Boolean(fieldError)} aria-describedby={`${id}-j-note`}
          className="min-h-11 bg-space text-ivory placeholder:text-stone" onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} />
        <p id={`${id}-j-note`} className={fieldError ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{fieldError ?? "Two-letter country code, e.g. IN, US, GB."}</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}
      <Button type="submit" className="min-h-11" disabled={pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Create organization</Button>
    </form>
  );
}
