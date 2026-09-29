"use client";

import { ApiError, describeError, type ApiClient } from "@repo/api-client";
import type { ContactType, ContactView } from "@repo/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { OtpInput } from "./otp-input";

type Client = Pick<ApiClient, "addContact" | "verifyContact" | "resendContact">;
const LABEL: Record<ContactType, string> = { email: "Email address", phone: "Phone number" };
const PLACEHOLDER: Record<ContactType, string> = { email: "you@example.com", phone: "+91 98765 43210" };

function useCountdown(untilIso: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!untilIso) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [untilIso]);
  return left;
}

export function ContactVerifier({ type, existing, onVerified, client = api }: { type: ContactType; existing?: ContactView; onVerified?(c: ContactView): void; client?: Client }) {
  const ids = { value: useId(), code: useId(), error: useId() };
  const [value, setValue] = useState(existing?.value ?? "");
  const [contact, setContact] = useState<ContactView | null>(existing ?? null);
  const [code, setCode] = useState("");
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const left = useCountdown(resendAt);
  const verified = contact?.status === "verified";
  const awaitingCode = contact !== null && !verified && resendAt !== null;

  async function guard(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    try { await fn(); } catch (e) {
      if (e instanceof ApiError) setError(e.code === "VALIDATION_FAILED" ? e.message : describeError(e.code).title);
      else setError(describeError("INTERNAL").title);
    } finally { setPending(false); }
  }

  const send = () => guard(async () => {
    const out = await client.addContact({ type, value });
    setContact(out.contact);
    setResendAt(out.verification.resendAvailableAt);
    setCode("");
  });
  const resend = () => guard(async () => {
    if (!contact) return;
    const out = await client.resendContact(contact.id);
    setResendAt(out.verification.resendAvailableAt);
  });
  const verify = () => guard(async () => {
    if (!contact) return;
    const out = await client.verifyContact(contact.id, { code });
    setContact(out);
    setResendAt(null);
    onVerified?.(out);
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={ids.value} className="text-xs font-medium text-ivory">{LABEL[type]}</Label>
          {contact && <StatusBadge tone={verified ? "success" : "warning"} label={verified ? "Verified" : "Unverified"} />}
        </div>
        <Input id={ids.value} type={type === "email" ? "email" : "tel"} autoComplete={type === "email" ? "email" : "tel"}
          placeholder={PLACEHOLDER[type]} value={value} aria-invalid={Boolean(error)} aria-describedby={error ? ids.error : undefined}
          onChange={(e) => setValue(e.target.value)} disabled={awaitingCode || pending}
          className="min-h-11 bg-space text-ivory placeholder:text-stone" />
      </div>

      {awaitingCode ? (
        <>
          <OtpInput id={ids.code} value={code} onChange={setCode} />
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11" disabled={code.length !== 6 || pending} onClick={() => void verify()}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}Verify
            </Button>
            <Button variant="secondary" className="min-h-11" disabled={left > 0 || pending} onClick={() => void resend()}>
              {left > 0 ? `Resend in ${left} s` : "Resend code"}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => { setContact(existing ?? null); setResendAt(null); }}>Change {type}</Button>
          </div>
        </>
      ) : !verified ? (
        <Button className="min-h-11" disabled={value.trim().length < 3 || pending} onClick={() => void send()}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}Send code
        </Button>
      ) : null}

      {error && <p id={ids.error} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
