"use client";

import { waitlistJoinSchema, type WaitlistJoinResponse } from "@repo/validator";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Join the waitlist: name and email, optional phone and country. Validated with the API's schema before sending. */
export function WaitlistForm({ className }: { className?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WaitlistJoinResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = waitlistJoinSchema.safeParse({ name, email, phone: phone.trim() || undefined, country: country.trim() || undefined });
    if (!parsed.success) {
      setError({ title: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      return;
    }
    setPending(true);
    try {
      setResult(await api.joinWaitlist(parsed.data));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setPending(false);
    }
  }

  const card = cn("glass rounded-card p-6 text-left shadow-float sm:p-8", className);
  if (result) {
    return (
      <div role="status" className={card}>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check aria-hidden className="size-4" /></span>
          <div>
            <p className="type-heading text-ink">{result.joined ? "You're on the list" : "You're already on the list"}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {result.emailSent
                ? "Check your inbox for a note from Sameer, our cofounder. We'll email you when there's news worth sharing."
                : "We couldn't send your confirmation email just now. Join again later with the same email to receive it."}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} aria-label="Join the waitlist" className={card} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="wl-name">Name</Label>
          <Input id="wl-name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-2" />
        </div>
        <div>
          <Label htmlFor="wl-email">Email</Label>
          <Input id="wl-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-2" />
        </div>
        <div>
          <Label htmlFor="wl-phone">Phone <span className="text-ink-faint">(optional)</span></Label>
          <Input id="wl-phone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" className="mt-2" />
        </div>
        <div>
          <Label htmlFor="wl-country">Country <span className="text-ink-faint">(optional)</span></Label>
          <Input id="wl-country" name="country" autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" maxLength={2} aria-describedby="wl-country-hint" className="mt-2 uppercase" />
          <p id="wl-country-hint" className="mt-1 text-xs text-ink-faint">Two-letter code, e.g. US, IN, GB.</p>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error.title}{error.message ? ` — ${error.message}` : ""}</p>}
      <Button type="submit" size="lg" disabled={pending} className="mt-6 w-full">
        {pending ? <><Loader2 className="animate-spin" aria-hidden /> Joining…</> : "Join the waitlist"}
      </Button>
      <p className="mt-3 text-center text-xs text-ink-faint">One welcome email now, then only news worth sharing.</p>
    </form>
  );
}
