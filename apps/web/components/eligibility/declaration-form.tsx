"use client";

import { ApiError } from "@repo/api-client";
import { ELIGIBILITY_ATTESTATION, INVESTOR_STATUSES, type InvestorStatus } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";

export const STATUS_LABEL: Record<InvestorStatus, { title: string; help: string }> = {
  retail: { title: "Retail investor", help: "You invest as an individual and do not meet an accredited, qualified or professional test." },
  accredited: { title: "Accredited investor", help: "You meet your country's accredited-investor test (for example income or net worth thresholds)." },
  qualified: { title: "Qualified investor", help: "You meet your country's qualified-investor test, for example by experience or portfolio size." },
  professional: { title: "Professional investor", help: "You work in or are treated as a professional in financial markets." },
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Every region the browser can name: two-letter codes whose display name is not just the code. */
const countries = (): { code: string; name: string }[] => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const out: { code: string; name: string }[] = [];
  for (const a of LETTERS) for (const b of LETTERS) {
    const code = a + b;
    const name = names.of(code);
    if (name && name !== code) out.push({ code, name });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
};
export const countryName = (code: string) => new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;

/** True when the API refused the request because the user has no current eligibility declaration. */
export const isDeclarationRequired = (e: unknown) => e instanceof ApiError && e.code === "DECLARATION_REQUIRED";

/** Country, investor status and attestation. The server decides what the declaration allows; this only records it. */
export function DeclarationForm({ onSaved }: { onSaved?: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const list = useMemo(countries, []);
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<InvestorStatus | "">("");
  const [agreed, setAgreed] = useState(false);
  const save = useMutation({
    mutationFn: () => api.declareEligibility({ country, investorStatus: status as InvestorStatus, attestationVersion: ELIGIBILITY_ATTESTATION.version }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["eligibility"] }); onSaved?.(); },
  });
  const ready = country !== "" && status !== "" && agreed;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-c`} className="text-xs font-medium text-ink">Country of residence</Label>
        <Select id={`${id}-c`} value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Choose a country</option>
          {list.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </Select>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink">Investor status</legend>
        {INVESTOR_STATUSES.map((s) => (
          <label key={s} className="flex min-h-11 items-start gap-3 text-sm">
            <input type="radio" name={`${id}-s`} value={s} checked={status === s} onChange={() => setStatus(s)} className="mt-1 accent-mint" />
            <span><span className="text-ink">{STATUS_LABEL[s].title}</span><span className="block text-xs text-ink-muted">{STATUS_LABEL[s].help}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 accent-mint" />
        <span className="text-ink-muted">{ELIGIBILITY_ATTESTATION.text}</span>
      </label>
      <Button type="submit"  disabled={!ready || save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save declaration</Button>
      {save.isError && <ErrorBox error={save.error} />}
    </form>
  );
}
