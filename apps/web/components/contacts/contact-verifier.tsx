"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { describeError, useCountdown } from "@repo/app-core";
import type { ContactType, ContactView } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { OtpInput } from "./otp-input";

type Client = Pick<ApiClient, "addContact" | "verifyContact" | "resendContact">;
const LABEL: Record<ContactType, string> = { email: "Email address", phone: "Phone number" };
const PLACEHOLDER: Record<ContactType, string> = { email: "you@example.com", phone: "+91 98765 43210" };

export function ContactVerifier({ type, existing, onVerified, onChanged, client = api }: { type: ContactType; existing?: ContactView; onVerified?(c: ContactView): void; onChanged?(): void; client?: Client }) {
  const ids = { value: useId(), code: useId(), error: useId() };
  const [value, setValue] = useState(existing?.value ?? "");
  const [contact, setContact] = useState<ContactView | null>(existing ?? null);
  const [code, setCode] = useState("");
  // An unverified contact that already exists server-side has a pending code: go straight to code entry (resend is allowed; the server enforces its cooldown).
  const [resendAt, setResendAt] = useState<string | null>(() => (existing && existing.status !== "verified" ? new Date().toISOString() : null));
  const [error, setError] = useState<{ title: string; message?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const left = useCountdown(resendAt);
  const verified = contact?.status === "verified";
  const awaitingCode = contact !== null && !verified && resendAt !== null;

  const busy = useRef(false);
  async function guard(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try { await fn(); } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "VALIDATION_FAILED") setError({ title: e.message });
        else {
          const d = describeError(e.code);
          setError({ title: d.title, message: d.message });
          if (e.code === "OTP_COOLDOWN" && e.retryAfterSec !== undefined) setResendAt(new Date(Date.now() + e.retryAfterSec * 1000).toISOString());
        }
      } else {
        const d = describeError("INTERNAL");
        setError({ title: d.title, message: d.message });
      }
    } finally { busy.current = false; setPending(false); }
  }

  const send = () => guard(async () => {
    const out = await client.addContact({ type, value });
    setContact(out.contact);
    setResendAt(out.verification.resendAvailableAt);
    setCode("");
    onChanged?.();
  });
  const resend = () => guard(async () => {
    if (!contact) return;
    const out = await client.resendContact(contact.id);
    setResendAt(out.verification.resendAvailableAt);
    onChanged?.();
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
            <Button variant="ghost" className="min-h-11" onClick={() => { setContact(null); setResendAt(null); setCode(""); setError(null); }}>Change {type}</Button>
          </div>
        </>
      ) : !verified ? (
        <Button className="min-h-11" disabled={value.trim().length < 3 || pending} onClick={() => void send()}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}Send code
        </Button>
      ) : (
        <Button variant="ghost" className="min-h-11" onClick={() => { setContact(null); setResendAt(null); setValue(""); setCode(""); setError(null); }}>Change</Button>
      )}

      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          <span className="font-medium">{error.title}</span>
          {error.message && <> <span>{error.message}</span></>}
        </p>
      )}
    </div>
  );
}
