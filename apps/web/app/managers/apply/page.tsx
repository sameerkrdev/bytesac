import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationForm } from "@/components/managers/application-form";

export const metadata: Metadata = { title: "Become a fund manager" };

const STEPS = [
  ["Apply", "Tell us who you are and how you manage money. We confirm your email first."],
  ["Screening", "Our team reviews your application and may ask for more information."],
  ["Create your organization", "Add its details and documents, and prove control of its payout wallet."],
  ["Verification", "Once Bytesac verifies the organization, invite your team and start drafting baskets."],
];

export default function ApplyPage() {
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_32rem] lg:gap-16">
      <div className="space-y-8">
        <div className="space-y-4">
          <p className="type-eyebrow text-ink-faint">For strategy managers</p>
          <h1 className="type-display text-ink">Become a fund manager</h1>
          <p className="max-w-lg type-lede text-ink-muted">Tell us about yourself. We&apos;ll confirm your email, then our team reviews your application.</p>
        </div>
        <ol className="max-w-md space-y-5">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[2.25rem_1fr] gap-4">
              <span className="grid size-9 place-items-center rounded-full border border-line-strong font-mono text-[0.6875rem] text-ink">0{i + 1}</span>
              <span className="pt-1.5"><span className="block font-medium text-ink">{t}</span><span className="mt-1 block text-sm text-ink-muted">{d}</span></span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-ink-muted">Already applied? <Link href="/managers/status" className="text-ink underline underline-offset-4">Check your application</Link></p>
      </div>
      <div className="rounded-shell border border-line bg-surface p-6 shadow-float sm:p-8">
        <ApplicationForm />
      </div>
    </div>
  );
}
