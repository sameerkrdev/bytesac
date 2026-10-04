import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { GlassObject, Sky } from "@/components/visual/scenery";

const POINTS = [
  "Signing in proves you control your wallet. It never authorizes a transaction.",
  "Your assets stay in your own wallets. Bytesac never holds your keys or funds.",
  "Every future transaction is shown to you first and signed by you, step by step.",
];

/**
 * Split frame for sign-in and onboarding: an atmospheric panel that explains what is being signed, and the task on
 * the right. On phones the panel collapses to a short band above the task.
 */
export function AuthFrame({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section aria-label="About signing in" className="relative isolate flex flex-col overflow-hidden px-6 pt-6 pb-10 sm:px-10 lg:min-h-dvh lg:pb-12">
        <Sky className="-z-10" fade={false} priority />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-canvas/70 via-transparent to-transparent lg:hidden" />
        <Link href="/" aria-label="Bytesac home" className="inline-flex min-h-11 w-fit items-center"><Logo size={24} /></Link>
        <div className="mt-10 max-w-lg lg:mt-auto">
          <h2 className="type-title text-ink">{title}</h2>
          <ul className="mt-8 hidden space-y-4 lg:block">
            {POINTS.map((p) => <li key={p} className="flex gap-3 text-ink-muted"><Check aria-hidden className="mt-1 size-4 shrink-0 text-ink" />{p}</li>)}
          </ul>
          {aside}
        </div>
        <GlassObject name="glass-wallet" className="pointer-events-none absolute top-[18%] right-[-6%] hidden w-[46%] max-w-md opacity-90 lg:block" sizes="420px" />
      </section>
      <main id="main" className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center lg:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
