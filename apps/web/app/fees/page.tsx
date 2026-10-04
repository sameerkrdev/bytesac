import { publicFeesSchema } from "@repo/validator";
import type { Metadata } from "next";
import { PLATFORM_OPERATION_LABEL, rateText } from "@/lib/fees";
import { PageLayout } from "@/components/layout/page-layout";

export const metadata: Metadata = { title: "Fees" };

const KINDS = [
  { t: "Network fee", d: "Paid to Bytesac for the gas it fronts on your behalf. Shown as an amount before you sign." },
  { t: "Manager fee", d: "Set by the organization that runs the basket — entry and rebalance fees are collected; management and subscription fees are disclosed but not collected in this release." },
  { t: "Platform fee", d: "Bytesac’s own rate, by operation. A basket or organization may have a different rate, shown on the basket." },
];

export default async function PublicFeesPage() {
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/fees`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET public fees failed: ${res.status}`);
  const { platform } = publicFeesSchema.parse(await res.json());
  return (
    <PageLayout title="Fees" eyebrow="Pricing" description="Every fee is listed before you sign, paid up front in USDC in the first step of an operation, and shown again in your activity." className="max-w-4xl">
      <section aria-label="Platform fees" className="space-y-4">
        <h2 className="type-heading text-ink">Bytesac platform fees</h2>
        {platform.length === 0 ? <p className="text-sm text-ink-muted">Bytesac charges no platform fee right now.</p> : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {platform.map((p) => (
              <li key={p.operationKind} className="flex min-h-14 items-center px-5 text-sm text-ink">{PLATFORM_OPERATION_LABEL[p.operationKind]}: {rateText(p.bps, p.minUsdc, p.maxUsdc)}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Fee types" className="grid gap-4 md:grid-cols-3">
        {KINDS.map((k) => (
          <article key={k.t} className="rounded-card border border-line bg-surface p-6">
            <h3 className="text-base font-medium text-ink">{k.t}</h3>
            <p className="mt-2 text-sm text-ink-muted">{k.d}</p>
          </article>
        ))}
      </section>
      <div className="space-y-2 text-sm text-ink-muted">
        <p>Fund managers set their own fees; each is shown on the basket&apos;s page. Individual baskets or organizations may have a different platform rate, also shown on the basket.</p>
        <p>Every operation also pays a network fee to Bytesac for gas. Fees are paid up front in USDC and are not refunded if the operation does not complete.</p>
      </div>
    </PageLayout>
  );
}
