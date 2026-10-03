import { BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { publicManagerSchema } from "@repo/validator";
import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/layout/page-layout";

export const metadata: Metadata = { title: "Manager · Bytesac" };

const date = (iso: string) => new Date(iso).toLocaleDateString();
const SelfReported = () => <span className="ml-2 rounded border border-border-dark px-1.5 py-0.5 text-xs text-stone">Self-reported</span>;

export default async function PublicManagerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/managers/${encodeURIComponent(handle)}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public manager failed: ${res.status}`);
  const m = publicManagerSchema.parse(await res.json());

  const baskets = [["Current baskets", m.baskets.filter((b) => b.to === null)], ["Previous baskets", m.baskets.filter((b) => b.to !== null)]] as const;
  const orgs = [["Current organizations", m.organizations.filter((o) => o.current)], ["Former organizations", m.organizations.filter((o) => !o.current)]] as const;
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">{m.displayName}</h1>
        {m.headline && <p className="text-base text-ivory">{m.headline}</p>}
        <p className="text-sm text-stone">@{m.handle}</p>
        {m.verified && <span className="inline-flex items-center gap-1 rounded-lg border border-success/40 px-2 py-0.5 text-xs font-medium text-success"><BadgeCheck aria-hidden className="size-3.5" />Verified by Bytesac</span>}
      </div>

      <dl className="space-y-4">
        {m.bio && <div><dt className="text-xs text-stone">About</dt><dd className="whitespace-pre-wrap text-sm text-ivory">{m.bio}</dd></div>}
        {m.background && <div><dt className="text-xs text-stone">Background</dt><dd className="whitespace-pre-wrap text-sm text-ivory">{m.background}</dd></div>}
        {m.experienceYears !== null && <div><dt className="text-xs text-stone">Experience{m.selfReported.includes("experienceYears") && <SelfReported />}</dt><dd className="text-sm text-ivory">{m.experienceYears} years</dd></div>}
        {m.qualifications.length > 0 && (
          <div><dt className="text-xs text-stone">Qualifications{m.selfReported.includes("qualifications") && <SelfReported />}</dt>
            <dd><ul className="list-disc pl-5 text-sm text-ivory">{m.qualifications.map((q) => <li key={q}>{q}</li>)}</ul></dd></div>
        )}
        {m.links.length > 0 && (
          <div><dt className="text-xs text-stone">Links</dt>
            <dd><ul className="space-y-1 text-sm">{m.links.map((l) => <li key={l.url}>{l.url.startsWith("https://") ? <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="text-mint underline">{l.label}</a> : l.label}</li>)}</ul></dd></div>
        )}
      </dl>

      {baskets.map(([title, list]) => list.length > 0 && (
        <section key={title} aria-label={title} className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
          <ul className="space-y-2">
            {list.map((b) => (
              <li key={`${b.slug}-${b.from}`} className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={`/baskets/${b.slug}`} className="font-medium text-mint underline">{b.name}</Link>
                <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
                <span className="text-stone">{b.role === "lead" ? "Lead" : "Co-manager"} · from {date(b.from)}{b.to && ` to ${date(b.to)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {orgs.map(([title, list]) => list.length > 0 && (
        <section key={title} aria-label={title} className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
          <ul className="space-y-2">
            {list.map((o) => (
              <li key={`${o.organizationId}-${o.from}`} className="text-sm text-ivory">
                <Link href={`/organizations/${o.organizationId}`} className="font-medium text-mint underline">{o.organizationName ?? "Organization"}</Link>
                <span className="text-stone"> · {o.title ?? o.role} · from {date(o.from)}{o.to && ` to ${date(o.to)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
