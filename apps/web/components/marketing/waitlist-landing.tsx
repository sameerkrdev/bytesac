"use client";

import { waitlistJoinSchema } from "@repo/validator";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Sky } from "@/components/visual/scenery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";

export function WaitlistLanding() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = waitlistJoinSchema.safeParse({
      name,
      email,
      phone: phone.trim() || undefined,
      country: country.trim() || undefined,
    });
    if (!parsed.success) {
      setError({ title: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      return;
    }
    setPending(true);
    try {
      await api.joinWaitlist(parsed.data);
      setDone(true);
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-canvas">
      <Sky className="pointer-events-none absolute inset-0 h-[min(72vh,640px)] w-full opacity-90" />
      <div className="relative mx-auto flex w-full max-w-lg flex-col px-4 pb-20 pt-24 sm:px-6 sm:pt-32">
        <p className="type-eyebrow text-ink-muted">Bytesac</p>
        <h1 className="type-display mt-3 text-ink">Join the waitlist</h1>
        <p className="type-lede mt-4 text-ink-muted">
          Manager-led baskets across chains, with your assets staying in your wallets. We&apos;re opening carefully — tell us where to reach you.
        </p>

        {done ? (
          <div className="mt-10 rounded-card border border-line bg-surface p-8 shadow-soft">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div>
                <p className="type-heading text-ink">You&apos;re on the list</p>
                <p className="mt-2 text-ink-muted">Check your inbox for a note from Sameer, our cofounder. We&apos;ll email you when there&apos;s news worth sharing.</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 space-y-5 rounded-card border border-line bg-surface p-8 shadow-soft">
            <div>
              <Label htmlFor="wl-name">Name</Label>
              <Input id="wl-name" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-2" />
            </div>
            <div>
              <Label htmlFor="wl-email">Email</Label>
              <Input id="wl-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-2" />
            </div>
            <div>
              <Label htmlFor="wl-phone">Phone (optional)</Label>
              <Input id="wl-phone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="wl-country">Country (optional)</Label>
              <Input id="wl-country" name="country" autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" maxLength={2} className="mt-2" />
              <p className="mt-1 text-sm text-ink-faint">Two-letter code, e.g. US, IN, GB.</p>
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error.title}{error.message ? ` — ${error.message}` : ""}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? <><Loader2 className="animate-spin" aria-hidden /> Joining…</> : "Join waitlist"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
