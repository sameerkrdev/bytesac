"use client";

import type { ApiClient } from "@repo/api-client";
import { PLATFORM_FEE_OPERATIONS, platformFeeOverrideInputSchema, platformFeeScheduleInputSchema, type PlatformFeeScheduleView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { PLATFORM_OPERATION_LABEL, rateText } from "@/lib/fees";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListFees" | "opsSaveFee" | "opsListFeeOverrides" | "opsSaveFeeOverride" | "opsEndFeeOverride">;

const when = (iso: string) => new Date(iso).toLocaleDateString();
const rate = (r: PlatformFeeScheduleView) => rateText(r.bps, r.minUsdc, r.maxUsdc);

/** One form for a default-schedule change (override false) and a new override. The server validates again. */
function ScheduleForm({ override, onSubmit, pending, error }: { override: boolean; onSubmit(body: unknown): void; pending: boolean; error: unknown }) {
  const id = useId();
  const [v, setV] = useState({ scope: "organization", scopeId: "", operationKind: "invest", bps: "0", minUsdc: "", maxUsdc: "", endsAt: "", reason: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const field = (k: keyof typeof v, label: string, props: { type?: string; inputMode?: "decimal" | "numeric" } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${k}`} className="text-xs font-medium text-ink">{label}</Label>
      <Input id={`${id}-${k}`} value={v[k]} onChange={set(k)}  {...props} />
    </div>
  );
  return (
    <form className="grid max-w-xl gap-3" onSubmit={(e) => {
      e.preventDefault();
      const body = {
        ...(override && { scope: v.scope, scopeId: v.scopeId.trim() }), operationKind: v.operationKind, bps: Number(v.bps), reason: v.reason.trim(),
        ...(v.minUsdc && { minUsdc: v.minUsdc.trim() }), ...(v.maxUsdc && { maxUsdc: v.maxUsdc.trim() }), ...(override && v.endsAt && { endsAt: new Date(`${v.endsAt}T23:59:59Z`).toISOString() }),
      };
      const parsed = (override ? platformFeeOverrideInputSchema : platformFeeScheduleInputSchema).safeParse(body);
      setInvalid(parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the fields."));
      if (parsed.success) onSubmit(parsed.data);
    }}>
      {override && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-scope`} className="text-xs font-medium text-ink">Applies to</Label>
          <Select id={`${id}-scope`} value={v.scope} onChange={set("scope")}><option value="organization">Organization</option><option value="basket">Basket</option></Select>
        </div>
      )}
      {override && field("scopeId", "Organization or basket ID")}
      <div className="space-y-1">
        <Label htmlFor={`${id}-op`} className="text-xs font-medium text-ink">Operation</Label>
        <Select id={`${id}-op`} value={v.operationKind} onChange={set("operationKind")}>{PLATFORM_FEE_OPERATIONS.map((o) => <option key={o} value={o}>{PLATFORM_OPERATION_LABEL[o]}</option>)}</Select>
      </div>
      {field("bps", "Rate (basis points, 0 to 100)", { inputMode: "numeric" })}
      {field("minUsdc", "Minimum (USDC, optional)", { inputMode: "decimal" })}
      {field("maxUsdc", "Maximum (USDC, optional)", { inputMode: "decimal" })}
      {override && field("endsAt", "End date (optional)", { type: "date" })}
      {field("reason", "Reason")}
      <Button type="submit" className="min-h-11 w-fit" disabled={pending}>{override ? "Create override" : "Save schedule"}</Button>
      {invalid && <p role="alert" className="text-xs text-danger">{invalid}</p>}
      {error ? <OpsError error={error} /> : null}
    </form>
  );
}

export function FeeSchedules({ client = api }: { client?: Client }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.platformRoles.includes("ops_admin") ?? false;
  const fees = useQuery({ queryKey: ["ops", "fees"], queryFn: () => client.opsListFees(), retry: false });
  const overrides = useQuery({ queryKey: ["ops", "fee-overrides"], queryFn: () => client.opsListFeeOverrides(), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops"] });
  const save = useMutation({ mutationFn: (b: Parameters<Client["opsSaveFee"]>[0]) => client.opsSaveFee(b), onSuccess: refresh });
  const create = useMutation({ mutationFn: (b: Parameters<Client["opsSaveFeeOverride"]>[0]) => client.opsSaveFeeOverride(b), onSuccess: refresh });
  const end = useMutation({ mutationFn: (rid: string) => client.opsEndFeeOverride(rid), onSuccess: refresh });

  if (fees.isError) return <OpsError error={fees.error} />;
  if (!fees.data || !overrides.data) return <LoadingState />;
  const active = new Map(fees.data.items.filter((r) => r.supersededAt === null).map((r) => [r.operationKind, r]));
  const history = fees.data.items.filter((r) => r.supersededAt !== null);
  const liveOverrides = overrides.data.items.filter((r) => r.supersededAt === null);

  return (
    <div className="space-y-8">
      <PageHeader title="Platform fees" />
      <p className="text-sm text-ink-muted">The platform fee is charged up front in USDC together with the network fee and the manager fee. A basket override beats an organization override, which beats the default.</p>

      <section aria-label="Default schedule" className="space-y-3">
        <h2 className="type-heading text-ink">Default schedule</h2>
        <ul className="space-y-2">
          {PLATFORM_FEE_OPERATIONS.map((o) => {
            const r = active.get(o);
            return (
              <li key={o} className="flex flex-wrap gap-x-4 gap-y-1 rounded-tile border border-line bg-surface p-3 text-sm text-ink">
                <span className="font-medium">{PLATFORM_OPERATION_LABEL[o]}</span>
                <span>{r ? rate(r) : "No fee"}</span>
                {r && <span className="text-ink-muted">changed {when(r.createdAt)} · {r.reason}</span>}
              </li>
            );
          })}
        </ul>
        {isAdmin ? <ScheduleForm override={false} pending={save.isPending} error={save.error} onSubmit={(b) => save.mutate(b as Parameters<Client["opsSaveFee"]>[0])} />
          : <p className="text-xs text-ink-muted">Only an ops admin can change fees.</p>}
      </section>

      <section aria-label="History" className="space-y-2">
        <h2 className="type-heading text-ink">History</h2>
        {history.length === 0 ? <p className="text-sm text-ink-muted">No earlier schedules.</p> : (
          <ul className="space-y-1 text-sm text-ink-muted">{history.map((r) => <li key={r.id}>{PLATFORM_OPERATION_LABEL[r.operationKind]}: {rate(r)} · {when(r.createdAt)} to {when(r.supersededAt!)} · {r.reason}</li>)}</ul>
        )}
      </section>

      <section aria-label="Overrides" className="space-y-3">
        <h2 className="type-heading text-ink">Overrides</h2>
        {liveOverrides.length === 0 ? <p className="text-sm text-ink-muted">No active overrides.</p> : (
          <ul className="space-y-2">
            {liveOverrides.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-tile border border-line bg-surface p-3 text-sm text-ink">
                <span>{r.scope === "basket" ? "Basket" : "Organization"} <span className="break-all font-mono text-xs text-ink-muted">{r.scopeId}</span></span>
                <span>{PLATFORM_OPERATION_LABEL[r.operationKind]}: {rate(r)}</span>
                <span className="text-ink-muted">{r.endsAt ? `until ${when(r.endsAt)}` : "no end date"} · {r.reason}</span>
                {isAdmin && <Button variant="ghost" className="ml-auto min-h-11" aria-label={`End override ${r.id}`} disabled={end.isPending} onClick={() => end.mutate(r.id)}>End</Button>}
              </li>
            ))}
          </ul>
        )}
        {end.isError && <OpsError error={end.error} />}
        {isAdmin && <ScheduleForm override pending={create.isPending} error={create.error} onSubmit={(b) => create.mutate(b as Parameters<Client["opsSaveFeeOverride"]>[0])} />}
      </section>
    </div>
  );
}
