"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { useCountdown } from "@repo/app-core";
import { CHAINS, signInChainSchema, createApplicationRequestSchema } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { OtpInput } from "@/components/contacts/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ChoiceCard, StepForm } from "@/components/ui/step-form";
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
      if (created && !applicationId) { setApplicationId(created); setResendAt(new Date(Date.now() + 60_000).toISOString()); }
    } finally { setPending(false); }
  }

  const parse = () => createApplicationRequestSchema.safeParse({
    ...v,
    firmName: v.applicantType === "firm" ? v.firmName || undefined : undefined,
    phone: v.phone || undefined, website: v.website || undefined, qualifications: v.qualifications || undefined,
  });
  /** Validates only `names` (one step) against the full schema; returns whether they pass. */
  const checkStep = (names: Name[]) => {
    const parsed = parse();
    const errs: Partial<Record<Name, string>> = { ...fieldErrors };
    for (const n of names) delete errs[n];
    if (!parsed.success) for (const i of parsed.error.issues) { const n = i.path[0] as Name; if (names.includes(n)) errs[n] ??= i.message; }
    setFieldErrors(errs);
    return names.every((n) => !errs[n]);
  };

  const submit = () => {
    const parsed = parse();
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
        <p className="text-base text-ink">Check your email for your private status link.</p>
        <p className="text-sm text-ink-muted">Keep it safe: anyone with the link can see your application. It is shown here once.</p>
        <a href={link} className="block break-all rounded-control border border-line bg-canvas p-3 text-sm text-ink underline underline-offset-4">{link}</a>
      </div>
    );
  }

  if (applicationId) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">We sent a 6-digit code to <span className="text-ink">{v.email.trim().toLowerCase()}</span>. Confirm it to submit your application.</p>
        <OtpInput id={`${id}-code`} value={code} onChange={setCode} />
        <div className="flex flex-wrap gap-3">
          <Button  disabled={code.length !== 6 || pending} onClick={() => void confirm()}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}Confirm email
          </Button>
          <Button variant="secondary"  disabled={left > 0 || pending} onClick={() => void resend()}>
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
        <Label htmlFor={fid} className="text-xs font-medium text-ink">{label}</Label>
        {control({ id: fid, "aria-invalid": Boolean(fieldErrors[name]), "aria-describedby": `${fid}-note` })}
        <p id={`${fid}-note`} className={fieldErrors[name] ? "text-xs text-danger" : "text-xs text-ink-muted"}>{fieldErrors[name] ?? hint}</p>
      </div>
    );
  };

  const input = (t: (typeof TEXT)[number]) => field(t.name, t.label, t.hint, (p) => (
    <Input {...p} type={t.type} autoComplete={t.autoComplete} placeholder={t.placeholder} maxLength={t.name === "country" ? 2 : undefined}
      className="min-h-11 placeholder:text-ink-muted" value={v[t.name]}
      onChange={(e) => set(t.name, t.name === "country" ? e.target.value.toUpperCase() : e.target.value)} />
  ));
  const pick = (names: Name[]) => TEXT.filter((t) => names.includes(t.name)).map(input);
  const you: Name[] = ["applicantType", "firmName", "fullName", "country"];
  const contact: Name[] = ["email", "phone", "website"];
  const experience: Name[] = LONG.map((l) => l.name);
  const wallet: Name[] = ["walletChain", "walletAddress"];

  return (
    <StepForm label="Fund manager application" submitLabel="Submit application" pending={pending} onSubmit={() => void submit()} error={errorNode}
      steps={[
        {
          id: "you", title: "About you", description: "Who is applying.", validate: () => checkStep(you),
          content: (
            <>
              <div role="radiogroup" aria-label="Applying as" className="grid gap-2 sm:grid-cols-2">
                <ChoiceCard name={`${id}-type`} value="individual" checked={v.applicantType === "individual"} onChange={(x) => set("applicantType", x)} title="An individual" description="You manage strategies yourself." />
                <ChoiceCard name={`${id}-type`} value="firm" checked={v.applicantType === "firm"} onChange={(x) => set("applicantType", x)} title="A firm" description="A company that manages strategies." />
              </div>
              {v.applicantType === "firm" && field("firmName", "Firm name", undefined, (p) => <Input {...p} value={v.firmName} onChange={(e) => set("firmName", e.target.value)} />)}
              {pick(["fullName", "country"])}
            </>
          ),
        },
        { id: "contact", title: "How to reach you", description: "We confirm your email with a code before the application is submitted.", validate: () => checkStep(contact), content: <>{pick(contact)}</> },
        {
          id: "experience", title: "Your experience", description: "A few sentences each. The review team reads every application.", validate: () => checkStep(experience),
          content: <>{LONG.map((t) => field(t.name, t.label, t.hint, (p) => <Textarea {...p} rows={4} value={v[t.name]} onChange={(e) => set(t.name, e.target.value)} />))}</>,
        },
        {
          id: "wallet", title: "Wallet and review", description: "The wallet you'll sign in with after approval.", validate: () => checkStep(wallet),
          content: (
            <>
              {field("walletChain", "Wallet network", undefined, (p) => (
                <Select {...p} value={v.walletChain} onChange={(e) => set("walletChain", e.target.value)}>
                  {signInChainSchema.options.map((c) => <option key={c} value={c}>{CHAINS[c].label}</option>)}
                </Select>
              ))}
              {field("walletAddress", "Wallet address", "Entering it here doesn't prove ownership; you'll sign in with it after approval.", (p) => (
                <Input {...p} autoComplete="off" spellCheck={false} className="min-h-11 bg-canvas font-mono text-ink" value={v.walletAddress} onChange={(e) => set("walletAddress", e.target.value)} />
              ))}
              <dl className="divide-y divide-line rounded-tile border border-line bg-canvas text-sm">
                {([["Applying as", v.applicantType === "firm" ? `Firm · ${v.firmName || "—"}` : "Individual"], ["Name", v.fullName || "—"], ["Email", v.email || "—"], ["Country", v.country || "—"]] as const).map(([k, x]) => (
                  <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 px-4 py-2.5"><dt className="text-ink-muted">{k}</dt><dd className="truncate text-ink">{x}</dd></div>
                ))}
              </dl>
            </>
          ),
        },
      ]} />
  );
}
