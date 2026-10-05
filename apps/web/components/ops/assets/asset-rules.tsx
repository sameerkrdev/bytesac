"use client";

import type { ApiClient } from "@repo/api-client";
import { INVESTOR_STATUSES, createRuleRequestSchema, eligibilityActionSchema, eligibilityOutcomeSchema, type InvestorStatus } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { AssetError, ConfirmAction, type SectionProps } from "./asset-ui";

type Client = Pick<ApiClient, "opsCreateRule" | "opsUpdateRule">;
const blank = { routeId: "", jurisdiction: "", action: "acquire", outcome: "ALLOWED", kycRequirement: "", sourceText: "", sourceUrl: "" };

export function AssetRules({ a, locked, onChange, client = api }: SectionProps & { client?: Client }) {
  const id = useId();
  const [f, setF] = useState(blank);
  const [statuses, setStatuses] = useState<InvestorStatus[]>([]);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const create = useMutation({ mutationFn: (b: Parameters<Client["opsCreateRule"]>[1]) => client.opsCreateRule(a.id, b), onSuccess: (d) => { setF(blank); setStatuses([]); onChange(d); } });
  const retire = useMutation({ mutationFn: (rid: string) => client.opsUpdateRule(a.id, rid, { status: "RETIRED" }), onSuccess: onChange });
  const error = [create, retire].find((m) => m.isError)?.error;
  const live = a.routes.filter((r) => r.status !== "RETIRED");

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Eligibility rules</h2>
      {a.rules.length === 0 ? <p className="text-sm text-ink-muted">No rules yet.</p> : (
        <div className="relative overflow-x-auto"><table className="min-w-[36rem] w-full text-left text-sm">
          <thead className="text-xs text-ink-muted"><tr><th className="py-2 pr-4 font-medium">Jurisdiction</th><th className="pr-4 font-medium">Action</th><th className="pr-4 font-medium">Investor status</th><th className="pr-4 font-medium">Outcome</th><th className="pr-4 font-medium">Status</th><th className="font-medium"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {a.rules.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-3 pr-4 text-ink">{r.jurisdiction === "*" ? "All" : r.jurisdiction}</td>
                <td className="pr-4 text-ink-muted">{r.action}</td>
                <td className="pr-4 text-ink-muted">{r.investorStatuses.length === 0 ? "Any" : r.investorStatuses.join(", ")}</td>
                <td className="pr-4 text-ink-muted">{r.outcome.replaceAll("_", " ").toLowerCase()}</td>
                <td className="pr-4 text-ink-muted">{r.status === "RETIRED" ? "Retired" : "Active"}</td>
                <td>{r.status !== "RETIRED" && <ConfirmAction label="Retire" destructive disabled={locked} pending={retire.isPending} description="Retiring this rule is permanent." onConfirm={() => retire.mutate(r.id)} />}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {locked ? <p className="text-sm text-ink-muted">Rules can&apos;t be changed while the asset is under review or retired.</p> : (
        <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => {
          e.preventDefault();
          const parsed = createRuleRequestSchema.safeParse({
            routeId: f.routeId || undefined, jurisdiction: f.jurisdiction.trim().toUpperCase(), action: f.action, outcome: f.outcome, investorStatuses: statuses,
            kycRequirement: f.kycRequirement.trim() || undefined, sourceText: f.sourceText.trim() || undefined, sourceUrl: f.sourceUrl.trim() || undefined,
          });
          if (!parsed.success) return setInvalid("Use a two-letter country code or * for everywhere, and an https source URL.");
          setInvalid(null);
          create.mutate(parsed.data);
        }}>
          <h3 className="text-sm font-medium text-ink">Add a rule</h3>
          <div className="space-y-2">
            <Label htmlFor={`${id}-j`} className="text-xs font-medium text-ink">Jurisdiction (two-letter code, or * for everywhere)</Label>
            <Input id={`${id}-j`} maxLength={2} className="min-h-11 bg-canvas uppercase text-ink" value={f.jurisdiction} onChange={set("jurisdiction")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-a`} className="text-xs font-medium text-ink">Action</Label>
            <Select id={`${id}-a`} value={f.action} onChange={set("action")}>{eligibilityActionSchema.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-o`} className="text-xs font-medium text-ink">Outcome</Label>
            <Select id={`${id}-o`} value={f.outcome} onChange={set("outcome")}>{eligibilityOutcomeSchema.options.map((o) => <option key={o} value={o}>{o.replaceAll("_", " ").toLowerCase()}</option>)}</Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-ink">Investor statuses (none selected means every status)</legend>
            {INVESTOR_STATUSES.map((s) => (
              <label key={s} className="flex min-h-11 items-center gap-3 text-sm text-ink">
                <input type="checkbox" className="accent-mint" checked={statuses.includes(s)} onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s))} />{s}
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`${id}-r`} className="text-xs font-medium text-ink">Applies to route (optional)</Label>
            <Select id={`${id}-r`} value={f.routeId} onChange={set("routeId")}>
              <option value="">Whole asset</option>
              {live.map((r) => <option key={r.id} value={r.id}>{r.venue} · {r.method.replaceAll("_", " ")}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-k`} className="text-xs font-medium text-ink">KYC requirement (optional)</Label>
            <Input id={`${id}-k`}  value={f.kycRequirement} onChange={set("kycRequirement")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-st`} className="text-xs font-medium text-ink">Source note (optional)</Label>
            <Input id={`${id}-st`}  value={f.sourceText} onChange={set("sourceText")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-su`} className="text-xs font-medium text-ink">Source URL (optional)</Label>
            <Input id={`${id}-su`} type="url"  value={f.sourceUrl} onChange={set("sourceUrl")} />
          </div>
          {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
          <Button type="submit" className="min-h-11 w-fit" disabled={create.isPending}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Add rule</Button>
        </form>
      )}
      {error && <AssetError error={error} />}
    </section>
  );
}
