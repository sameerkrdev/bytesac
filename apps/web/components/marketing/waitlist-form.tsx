"use client";

import { waitlistEmailJoinSchema, type WaitlistJoinResponse } from "@repo/validator";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Join the waitlist with an email address. Validated with the API's schema before sending. */
export function WaitlistForm({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WaitlistJoinResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = waitlistEmailJoinSchema.safeParse({ email });
    if (!parsed.success) {
      setError({ title: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      return;
    }
    setPending(true);
    try {
      setResult(await api.joinWaitlistByEmail(parsed.data));
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
      <Label htmlFor="wl-email">Email</Label>
      <div className="mt-2 flex items-center gap-2">
        <Input id="wl-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="h-12 min-w-0 flex-1 rounded-pill px-5" />
        <Button type="submit" size="lg" disabled={pending} className="shrink-0">
          {pending ? <><Loader2 className="animate-spin" aria-hidden /> Joining…</> : "Join"}
        </Button>
      </div>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error.title}{error.message ? ` — ${error.message}` : ""}</p>}
      <p className="mt-3 text-center text-xs text-ink-faint">One welcome email now, then only news worth sharing.</p>
    </form>
  );
}
