"use client";

import { formatBps } from "@repo/app-core";
import { decimalStringSchema, feeWithinCap, maxFixedFeeUsdc, type BasketVersionView, type Fee } from "@repo/validator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PercentInput } from "./allocation-editor";

export type FeesState = Pick<BasketVersionView, "fees" | "minimumInvestmentUsdc" | "minimumIncrementUsdc">;

const FEES = [["entry", "Entry fee"], ["management", "Management fee (per year)"], ["rebalance", "Rebalance fee"]] as const;

/** Text field for a USDC amount. A fixed amount above 1% of the minimum is flagged here and again by the server. */
function Amount({ id, label, value, minimum, onChange, disabled }: { id: string; label: string; value: string; minimum: string | null; onChange(v: string): void; disabled: boolean }) {
  const valid = decimalStringSchema.safeParse(value).success;
  const min = minimum && decimalStringSchema.safeParse(minimum).success ? minimum : null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-ivory">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" value={value} disabled={disabled} aria-invalid={!valid} className="min-h-11 w-36 bg-space text-ivory" onChange={(e) => onChange(e.target.value)} />
        <span className="text-xs text-stone">USDC</span>
      </div>
      <p className="text-xs text-stone">{min ? `Up to ${maxFixedFeeUsdc(min)} USDC (1% of the minimum)` : "Set the minimum investment to see the limit."}</p>
      {value !== "" && !valid && <p role="alert" className="text-xs text-danger">Use a number with up to 6 decimals.</p>}
      {valid && min && !feeWithinCap(value, min) && <p role="alert" className="text-xs text-danger">This is more than 1% of the minimum investment.</p>}
    </div>
  );
}

export function FeesEditor({ value, onChange, readOnly }: { value: FeesState; onChange(patch: Partial<FeesState>): void; readOnly: boolean }) {
  const { fees, minimumInvestmentUsdc: min } = value;
  const setFee = (key: (typeof FEES)[number][0], fee: Fee) => onChange({ fees: { ...fees, [key]: fee } });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <Label htmlFor="min-invest" className="text-xs font-medium text-ivory">Minimum investment</Label>
          <div className="flex items-center gap-2">
            <Input id="min-invest" inputMode="decimal" value={min ?? ""} disabled={readOnly} className="min-h-11 w-36 bg-space text-ivory" onChange={(e) => onChange({ minimumInvestmentUsdc: e.target.value || null })} />
            <span className="text-xs text-stone">USDC</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="min-inc" className="text-xs font-medium text-ivory">Minimum increment (optional)</Label>
          <div className="flex items-center gap-2">
            <Input id="min-inc" inputMode="decimal" value={value.minimumIncrementUsdc ?? ""} disabled={readOnly} className="min-h-11 w-36 bg-space text-ivory" onChange={(e) => onChange({ minimumIncrementUsdc: e.target.value || null })} />
            <span className="text-xs text-stone">USDC</span>
          </div>
        </div>
      </div>

      {FEES.map(([key, label]) => {
        const fee = fees[key];
        return (
          <fieldset key={key} className="space-y-3 rounded-xl border border-border-dark p-4">
            <legend className="px-1 text-sm font-medium text-ivory">{label}</legend>
            <div className="space-y-1">
              <Label htmlFor={`${key}-type`} className="text-xs font-medium text-ivory">How is it charged?</Label>
              <Select id={`${key}-type`} value={fee.type} disabled={readOnly} onChange={(e) => setFee(key, e.target.value === "percent" ? { type: "percent", bps: 0 } : { type: "fixed", amountUsdc: "0" })}>
                <option value="percent">Percent</option>
                <option value="fixed">Fixed amount</option>
              </Select>
            </div>
            {fee.type === "percent" ? (
              <div className="space-y-1">
                <PercentInput id={`${key}-pct`} label={`${label} percent`} value={fee.bps} disabled={readOnly} onChange={(bps) => setFee(key, { type: "percent", bps: bps ?? 0 })} />
                <p className="text-xs text-stone">Up to {formatBps(100)}</p>
              </div>
            ) : (
              <Amount id={`${key}-amt`} label={`${label} amount`} value={fee.amountUsdc} minimum={min} disabled={readOnly} onChange={(v) => setFee(key, { type: "fixed", amountUsdc: v })} />
            )}
          </fieldset>
        );
      })}

      <fieldset className="space-y-3 rounded-xl border border-border-dark p-4">
        <legend className="px-1 text-sm font-medium text-ivory">Subscription</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ivory">
          <input type="checkbox" checked={fees.subscription !== null} disabled={readOnly} className="size-4"
            onChange={(e) => onChange({ fees: { ...fees, subscription: e.target.checked ? { amountUsdc: "0", period: "monthly" } : null } })} />
          Charge a subscription
        </label>
        {fees.subscription && (
          <div className="flex flex-wrap gap-4">
            <Amount id="sub-amt" label="Subscription amount" value={fees.subscription.amountUsdc} minimum={min} disabled={readOnly}
              onChange={(v) => onChange({ fees: { ...fees, subscription: { ...fees.subscription!, amountUsdc: v } } })} />
            <div className="space-y-1">
              <Label htmlFor="sub-period" className="text-xs font-medium text-ivory">Per</Label>
              <Select id="sub-period" value={fees.subscription.period} disabled={readOnly}
                onChange={(e) => onChange({ fees: { ...fees, subscription: { ...fees.subscription!, period: e.target.value as "monthly" | "yearly" } } })}>
                <option value="monthly">Month</option>
                <option value="yearly">Year</option>
              </Select>
            </div>
          </div>
        )}
      </fieldset>
      <p className="text-xs text-stone">Fees and minimums are disclosed terms. Nothing is charged or invested.</p>
    </div>
  );
}
