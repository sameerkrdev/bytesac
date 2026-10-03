import { publicFeesSchema } from "@repo/validator";
import type { Metadata } from "next";
import { PLATFORM_OPERATION_LABEL, rateText } from "@/lib/fees";
import { PageLayout } from "@/components/layout/page-layout";

export const metadata: Metadata = { title: "Fees · Bytesac" };

export default async function PublicFeesPage() {
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/fees`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET public fees failed: ${res.status}`);
  const { platform } = publicFeesSchema.parse(await res.json());
  return (
    <PageLayout title="Fees" className="max-w-3xl">
      <section aria-label="Platform fees" className="space-y-2">
        <h2 className="font-display text-xl font-semibold text-ivory">Bytesac platform fees</h2>
        {platform.length === 0 ? <p className="text-sm text-stone">Bytesac charges no platform fee right now.</p> : (
          <ul className="space-y-1 text-sm text-ivory">{platform.map((p) => <li key={p.operationKind}>{PLATFORM_OPERATION_LABEL[p.operationKind]}: {rateText(p.bps, p.minUsdc, p.maxUsdc)}</li>)}</ul>
        )}
      </section>
      <p className="text-sm text-stone">Fund managers set their own fees; each is shown on the basket&apos;s page. Individual baskets or organizations may have a different platform rate, also shown on the basket.</p>
      <p className="text-sm text-stone">Every operation also pays a network fee to Bytesac for gas. Fees are paid up front in USDC and are not refunded if the operation does not complete.</p>
    </PageLayout>
  );
}
