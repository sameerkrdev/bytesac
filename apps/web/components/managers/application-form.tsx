"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { useCountdown } from "@repo/app-core";
import { CHAINS, chainSchema, createApplicationRequestSchema } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { OtpInput } from "@/components/contacts/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "createApplication" | "confirmApplicationEmail" | "resendApplicationCode">;

const EMPTY = {
  applicantType: "individual", fullName: "", firmName: "", email: "", phone: "", country: "", website: "",
  professionalBackground: "", investmentExperience: "", qualifications: "", reason: "", intendedBaskets: "",
  walletChain: "ethereum", walletAddress: "",
};
type Values = typeof EMPTY;
type Name = keyof Values;

const TEXT: Array<{ name: Name; label: string; type?: string; autoComplete?: string; placeholder?: string; hint?: string }> = [
  { name: "fullName", label: "Full name", autoComplete: "name" },
  { name: "email", label: "Email address", type: "email", autoComplete: "email" },
  { name: "phone", label: "Phone (optional)", type: "tel", autoComplete: "tel", placeholder: "+91 98765 43210", hint: "Include the country code." },
  { name: "country", label: "Country", autoComplete: "country", placeholder: "IN", hint: "Two-letter country code, e.g. IN, US, GB." },
  { name: "website", label: "Website (optional)", type: "url", autoComplete: "url", placeholder: "https://example.com", hint: "Must start with https://" },
];
const LONG: Array<{ name: Name; label: string; hint: string }> = [
  { name: "professionalBackground", label: "Professional background", hint: "At least 20 characters." },
  { name: "investmentExperience", label: "Investment experience", hint: "At least 20 characters." },
  { name: "qualifications", label: "Qualifications (optional)", hint: "Licences, certifications, track record." },
  { name: "reason", label: "Why do you want to manage baskets on Bytesac?", hint: "At least 20 characters." },
  { name: "intendedBaskets", label: "What baskets do you plan to offer?", hint: "At least 20 characters." },
];

export function ApplicationForm({ client = api }: { client?: Client }) {
  const id = useId();
  const [v, setV] = useState<Values>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Name, string>>>({});
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [statusToken, setStatusToken] = useState<string | null>(null);
  const left = useCountdown(resendAt);
  const set = (name: Name, value: string) => setV((p) => ({ ...p, [name]: value }));

  async function guard(fn: () => Promise<void>) {
    setPending(true);
    setError(null);
    try { await fn(); } catch (e) {
      setError(toDisplayError(e));
      if (e instanceof ApiError && e.code === "OTP_COOLDOWN" && e.retryAfterSec !== undefined) setResendAt(new Date(Date.now() + e.retryAfterSec * 1000).toISOString());
      // The application exists but its code email failed: continue at the code step, where Resend is available.
      const created = e instanceof ApiError && e.code === "OTP_DELIVERY_FAILED" ? (e.details as { applicationId?: string } | undefined)?.applicationId : undefined;
      if (created && !applicationId) { setApplicationId(created); setResendAt(new Date().toISOString()); }
    } finally { setPending(false); }
  }

  const submit = () => {
    const parsed = createApplicationRequestSchema.safeParse({
      ...v,
      firmName: v.applicantType === "firm" ? v.firmName || undefined : undefined,
      phone: v.phone || undefined, website: v.website || undefined, qualifications: v.qualifications || undefined,
    });
    if (!parsed.success) {
      const errs: Partial<Record<Name, string>> = {};
      for (const i of parsed.error.issues) errs[i.path[0] as Name] ??= i.message;
      setFieldErrors(errs);
      setError({ title: "Check your details", message: "Some fields need attention." });
      return;
    }
    setFieldErrors({});
    return guard(async () => {
      const out = await client.createApplication(parsed.data);
      setApplicationId(out.applicationId);
      setResendAt(new Date(Date.now() + 60_000).toISOString());
    });
  };
  const confirm = () => guard(async () => {
    if (!applicationId) return;
    setStatusToken((await client.confirmApplicationEmail(applicationId, { code })).statusToken);
  });
  const resend = () => guard(async () => {
    if (!applicationId) return;
    await client.resendApplicationCode(applicationId);
    setResendAt(new Date(Date.now() + 60_000).toISOString());
    setCode("");
  });

  const errorNode = error && (
    <p role="alert" className="text-sm text-danger">
      <span className="font-medium">{error.title}</span>{error.message && <> {error.message}</>}
    </p>
  );

  if (statusToken) {
    const link = `${window.location.origin}/managers/status#${statusToken}`;
    return (
      <div className="space-y-4">
        <p className="text-base text-ivory">Check your email for your private status link.</p>
        <p className="text-sm text-muted-foreground">Keep it safe: anyone with the link can see your application. It is shown here once.</p>
        <a href={link} className="block break-all rounded-lg border border-border-dark bg-space p-3 text-sm text-mint underline">{link}</a>
      </div>
    );
  }

  if (applicationId) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">We sent a 6-digit code to <span className="text-ivory">{v.email.trim().toLowerCase()}</span>. Confirm it to submit your application.</p>
        <OtpInput id={`${id}-code`} value={code} onChange={setCode} />
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11" disabled={code.length !== 6 || pending} onClick={() => void confirm()}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}Confirm email
          </Button>
          <Button variant="secondary" className="min-h-11" disabled={left > 0 || pending} onClick={() => void resend()}>
            {left > 0 ? `Resend in ${left} s` : "Resend code"}
          </Button>
        </div>
        {errorNode}
      </div>
    );
  }

  const field = (name: Name, label: string, hint: string | undefined, control: (p: { id: string; "aria-invalid": boolean; "aria-describedby": string }) => ReactNode) => {
    const fid = `${id}-${name}`;
    return (
      <div key={name} className="space-y-2">
        <Label htmlFor={fid} className="text-xs font-medium text-ivory">{label}</Label>
        {control({ id: fid, "aria-invalid": Boolean(fieldErrors[name]), "aria-describedby": `${fid}-note` })}
        <p id={`${fid}-note`} className={fieldErrors[name] ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{fieldErrors[name] ?? hint}</p>
      </div>
    );
  };

  return (
    <form noValidate className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {field("applicantType", "Applying as", undefined, (p) => (
        <Select {...p} value={v.applicantType} onChange={(e) => set("applicantType", e.target.value)}>
          <option value="individual">Individual</option>
          <option value="firm">Firm</option>
        </Select>
      ))}
      {v.applicantType === "firm" && field("firmName", "Firm name", undefined, (p) => <Input {...p} className="min-h-11 bg-space text-ivory" value={v.firmName} onChange={(e) => set("firmName", e.target.value)} />)}
      {TEXT.map((t) => field(t.name, t.label, t.hint, (p) => (
        <Input {...p} type={t.type} autoComplete={t.autoComplete} placeholder={t.placeholder} maxLength={t.name === "country" ? 2 : undefined}
          className="min-h-11 bg-space text-ivory placeholder:text-stone" value={v[t.name]}
          onChange={(e) => set(t.name, t.name === "country" ? e.target.value.toUpperCase() : e.target.value)} />
      )))}
      {LONG.map((t) => field(t.name, t.label, t.hint, (p) => <Textarea {...p} value={v[t.name]} onChange={(e) => set(t.name, e.target.value)} />))}
      {field("walletChain", "Wallet network", undefined, (p) => (
        <Select {...p} value={v.walletChain} onChange={(e) => set("walletChain", e.target.value)}>
          {chainSchema.options.map((c) => <option key={c} value={c}>{CHAINS[c].label}</option>)}
        </Select>
      ))}
      {field("walletAddress", "Wallet address", "We'll ask you to sign in with this wallet after approval. Entering it here doesn't prove ownership.", (p) => (
        <Input {...p} autoComplete="off" spellCheck={false} className="min-h-11 bg-space font-mono text-ivory" value={v.walletAddress} onChange={(e) => set("walletAddress", e.target.value)} />
      ))}
      {errorNode}
      <Button type="submit" className="min-h-11 w-full" disabled={pending}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}Submit application
      </Button>
    </form>
  );
}
