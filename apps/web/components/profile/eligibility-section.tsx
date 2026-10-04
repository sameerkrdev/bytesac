"use client";

import { useQuery } from "@tanstack/react-query";
import { countryName, DeclarationForm, STATUS_LABEL } from "@/components/eligibility/declaration-form";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { LoadingState } from "@/components/layout/states";

/** The user's country and investor status, needed to buy tokenized assets. A new declaration replaces the current one. */
export function EligibilitySection() {
  const q = useQuery({ queryKey: ["eligibility"], queryFn: () => api.getEligibility() });
  const d = q.data?.declaration;
  return (
    <section aria-labelledby="eligibility-title" className="space-y-4 rounded-card border border-line bg-surface p-6">
      <div>
        <h2 id="eligibility-title" className="type-heading text-ink">Eligibility</h2>
        <p className="text-sm text-ink-muted">Tokenized assets are offered by country and investor status. The declaration is valid for 365 days.</p>
      </div>
      {q.isError ? <p role="alert" className="text-sm text-danger">{toDisplayError(q.error).title}</p> : q.isPending ? <LoadingState /> : d ? (
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink">
          <span>{countryName(d.country)} · {STATUS_LABEL[d.investorStatus].title}</span>
          <StatusBadge tone={d.expired ? "danger" : "success"} label={d.expired ? "Expired" : `Valid until ${new Date(d.expiresAt).toLocaleDateString()}`} />
        </p>
      ) : <p className="text-sm text-ink-muted">You have not declared yet.</p>}
      {!q.isPending && <DeclarationForm />}
    </section>
  );
}
