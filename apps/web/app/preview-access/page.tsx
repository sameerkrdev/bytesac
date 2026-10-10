"use client";

import { previewGateLoginSchema } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/surface";
import { toDisplayError, type DisplayError } from "@/lib/errors";

function PreviewAccessForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = previewGateLoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError({ title: "Enter a valid email and password." });
      return;
    }
    setPending(true);
    try {
      await api.previewGateLogin(parsed.data);
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame title={<>Internal preview<span className="block text-ink-muted">Bytesac is in soft launch. Sign in with your team credentials, then connect your wallet.</span></>}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="pg-email">Email</Label>
          <Input id="pg-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-2" />
        </div>
        <div>
          <Label htmlFor="pg-password">Password</Label>
          <Input id="pg-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-2" />
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error.title}{error.message ? ` — ${error.message}` : ""}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <><Loader2 className="animate-spin" aria-hidden /> Checking…</> : "Continue"}
        </Button>
      </form>
    </AuthFrame>
  );
}

export default function PreviewAccessPage() {
  return (
    <Suspense>
      <PreviewAccessForm />
    </Suspense>
  );
}
