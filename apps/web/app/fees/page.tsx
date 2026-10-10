import { publicFeesSchema } from "@repo/validator";
import { Building2, Fuel, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_OPERATION_LABEL, rateText } from "@/lib/fees";
import { API_ORIGIN, apiHeaders } from "@/lib/server-api";
import { PageHeader } from "@/components/layout/page-layout";

export const metadata: Metadata = { title: "Fees" };

const KINDS = [
  { icon: Fuel, t: "Network fee", who: "Paid to Bytesac", d: "For the gas Bytesac fronts on your behalf. Shown as an amount before you sign." },
  { icon: Building2, t: "Manager fee", who: "Paid to the organization", d: "Set by the organization that runs the basket. Entry and rebalance fees are collected; management and subscription fees are disclosed but not collected in this release." },
  { icon: Landmark, t: "Platform fee", who: "Paid to Bytesac", d: "Bytesac’s own rate, by operation. A basket or organization may have a different rate, shown on the basket." },
];

const FAQ = [
  ["When do I pay?", "Up front, in USDC, in the first step of an operation — after you have seen every fee in the plan and before anything is traded."],
  ["What if the operation doesn't complete?", "Fees are paid up front and are not refunded if the operation does not complete. Partial completion is shown step by step in your activity."],
  ["Where do I see what I paid?", "Every fee is listed before you sign and again in your activity, next to the operation it belongs to."],
  ["Do managers set their own fees?", "Yes. Each basket's fees are on its page, along with any platform rate that differs for that basket or organization."],
] as const;

export default async function PublicFeesPage() {
  const res = await fetch(`${API_ORIGIN}/v1/public/fees`, {
    headers: await apiHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET public fees failed: ${res.status}`);
  const { platform } = publicFeesSchema.parse(await res.json());
  return (
    <section aria-labelledby="page-title" className="space-y-14 md:space-y-20">
      <PageHeader id="page-title" title="Fees" eyebrow="Pricing" description="Every fee is listed before you sign, paid up front in USDC in the first step of an operation, and shown again in your activity." />

      <section aria-labelledby="kinds-title" className="space-y-6">
        <h2 id="kinds-title" className="type-heading text-ink">Three kinds of fee</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {KINDS.map((k, i) => (
            <li key={k.t} className="relative flex flex-col rounded-card border border-line bg-surface p-6">
              <div className="flex items-center justify-between">
                <span aria-hidden className="grid size-10 place-items-center rounded-full bg-surface-muted text-ink"><k.icon className="size-4.5" /></span>
                <span className="font-mono text-[0.6875rem] text-ink-faint">0{i + 1}</span>
              </div>
              <h3 className="mt-6 text-lg font-normal tracking-tight text-ink">{k.t}</h3>
              <p className="mt-1 text-xs text-ink-faint">{k.who}</p>
              <p className="mt-3 text-sm text-ink-muted">{k.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="platform-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        <div className="space-y-4">
          <h2 id="platform-title" className="type-heading text-ink">Bytesac platform fees</h2>
          {platform.length === 0 ? <p className="text-sm text-ink-muted">Bytesac charges no platform fee right now.</p> : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <table className="w-full text-sm">
                <caption className="sr-only">Platform fee by operation</caption>
                <thead><tr className="border-b border-line text-left text-xs text-ink-faint"><th scope="col" className="px-5 py-3 font-normal">Operation</th><th scope="col" className="px-5 py-3 text-right font-normal">Rate</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {platform.map((p) => (
                    <tr key={p.operationKind}><th scope="row" className="px-5 py-4 text-left font-normal text-ink">{PLATFORM_OPERATION_LABEL[p.operationKind]}</th><td className="px-5 py-4 text-right font-mono text-ink tabular-nums">{rateText(p.bps, p.minUsdc, p.maxUsdc)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside className="h-fit space-y-3 rounded-card border border-line bg-surface-muted/50 p-6 text-sm">
          <p className="font-medium text-ink">Rates can differ per basket</p>
          <p className="text-ink-muted">Fund managers set their own fees; each is shown on the basket&apos;s page.</p>
          <p className="text-ink-muted">An organization or a single basket may have its own platform rate. The rate that applies is always shown on the basket&apos;s page and in the plan you sign.</p>
          <Link href="/baskets" className="inline-block text-ink underline underline-offset-4">Browse baskets</Link>
        </aside>
      </section>

      <section aria-labelledby="faq-title" className="space-y-4">
        <h2 id="faq-title" className="type-heading text-ink">Common questions</h2>
        <div className="divide-y divide-line rounded-card border border-line bg-surface">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-ink">{q}<span aria-hidden className="text-ink-faint transition-transform group-open:rotate-45">+</span></summary>
              <p className="mt-2 max-w-3xl text-sm text-ink-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </section>
  );
}
