import { ApiError, describeError, type ApiClient } from "@repo/api-client";
import type { ContactType, ContactView } from "@repo/contracts";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { OtpField } from "./otp-field";

type Client = Pick<ApiClient, "addContact" | "verifyContact" | "resendContact">;
const LABEL: Record<ContactType, string> = { email: "Email address", phone: "Phone number" };

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

export function ContactVerifier({ type, existing, onVerified, onChanged, client = api }: {
  type: ContactType; existing?: ContactView; onVerified?(c: ContactView): void; onChanged?(): void; client?: Client;
}) {
  const [value, setValue] = useState(existing?.value ?? "");
  const [contact, setContact] = useState<ContactView | null>(existing ?? null);
  const [code, setCode] = useState("");
  // An unverified contact that exists server-side already has a pending code: go straight to code entry.
  const [resendAt, setResendAt] = useState<string | null>(() => (existing && existing.status !== "verified" ? new Date().toISOString() : null));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const left = useCountdown(resendAt);
  const verified = contact?.status === "verified";
  const awaitingCode = contact !== null && !verified && resendAt !== null;

  async function guard(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    try { await fn(); } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "VALIDATION_FAILED") setError(e.message);
        else {
          const d = describeError(e.code);
          setError(d.message ? `${d.title} ${d.message}` : d.title);
          if (e.code === "OTP_COOLDOWN" && e.retryAfterSec !== undefined) setResendAt(new Date(Date.now() + e.retryAfterSec * 1000).toISOString());
        }
      } else {
        const d = describeError("INTERNAL");
        setError(d.message ? `${d.title} ${d.message}` : d.title);
      }
    } finally { setPending(false); }
  }

  const change = (clearValue: boolean) => {
    setContact(null); setResendAt(null); setCode(""); setError(null);
    if (clearValue) setValue("");
  };
  const send = () => guard(async () => {
    const out = await client.addContact({ type, value });
    setContact(out.contact); setResendAt(out.verification.resendAvailableAt); setCode("");
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
    setContact(out); setResendAt(null);
    onVerified?.(out);
    onChanged?.();
  });

  return (
    <View className="gap-3">
      {contact && <StatusBadge tone={verified ? "success" : "warning"} label={verified ? "Verified" : "Unverified"} />}
      <TextField label={LABEL[type]} value={value} onChangeText={setValue} editable={!awaitingCode && !pending && !verified}
        keyboardType={type === "email" ? "email-address" : "phone-pad"} autoCapitalize="none"
        autoComplete={type === "email" ? "email" : "tel"} placeholder={type === "email" ? "you@example.com" : "+91 98765 43210"} error={error} />
      {awaitingCode ? (
        <>
          <OtpField value={code} onChange={setCode} />
          <Button onPress={() => void verify()} disabled={code.length !== 6} loading={pending}>Verify</Button>
          <Button variant="secondary" disabled={left > 0 || pending} onPress={() => void resend()}>
            {left > 0 ? `Resend in ${left} s` : "Resend code"}
          </Button>
          <Button variant="ghost" onPress={() => change(false)}>{`Change ${type}`}</Button>
        </>
      ) : verified ? (
        <Button variant="ghost" onPress={() => change(false)}>Change</Button>
      ) : (
        <Button disabled={value.trim().length < 3} loading={pending} onPress={() => void send()}>Send code</Button>
      )}
      {!contact && <AppText variant="label" tone="stone">Required later before investing.</AppText>}
    </View>
  );
}
