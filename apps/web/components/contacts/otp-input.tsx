"use client";
import { normalizeOtp } from "@repo/app-core";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OtpInput({ id, value, onChange, label = "6-digit code" }: { id: string; value: string; onChange(v: string): void; label?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-medium text-ivory">{label}</Label>
      <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={value}
        onChange={(e) => onChange(normalizeOtp(e.target.value))}
        className="min-h-11 bg-space font-mono tracking-[0.4em] text-ivory" />
    </div>
  );
}
