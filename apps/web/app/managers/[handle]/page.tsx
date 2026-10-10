import { BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { publicManagerSchema } from "@repo/validator";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Monogram, ProfileHero, VerifiedBadge } from "@/components/layout/profile-hero";
import { API_ORIGIN, apiHeaders } from "@/lib/server-api";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Manager" };

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const SelfReported = () => <span className="ml-2 rounded-pill bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-normal tracking-normal normal-case text-ink-muted">Self-reported</span>;

export default async function PublicManagerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const res = await fetch(`${API_ORIGIN}/v1/public/managers/${encodeURIComponent(handle)}`, {
    headers: await apiHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public manager failed: ${res.status}`);
  const m = publicManagerSchema.parse(await res.json());

  const baskets = [["Current baskets", m.baskets.filter((b) => b.to === null)], ["Previous baskets", m.baskets.filter((b) => b.to !== null)]] as const;
  const orgs = [["Current organizations", m.organizations.filter((o) => o.current)], ["Former organizations", m.organizations.filter((o) => !o.current)]] as const;
  return (
    <div className="space-y-12">
      <ProfileHero name={m.displayName} eyebrow="Strategy manager" crumbs={[{ label: "Baskets", href: "/baskets" }, { label: m.displayName }]}
        meta={<>{m.headline && <span className="text-ink">{m.headline}</span>}<span className="font-mono text-xs">@{m.handle}</span>{m.verified && <VerifiedBadge />}</>} />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <dl className="grid content-start gap-x-10 gap-y-8 sm:grid-cols-2">
          {m.bio && <div className="sm:col-span-2"><dt className="type-eyebrow text-ink-faint">About</dt><dd className="mt-2 text-lg leading-relaxed font-light whitespace-pre-wrap text-ink">{m.bio}</dd></div>}
          {m.background && <div className="sm:col-span-2"><dt className="type-eyebrow text-ink-faint">Background</dt><dd className="mt-2 whitespace-pre-wrap text-ink">{m.background}</dd></div>}
          {m.experienceYears !== null && <div><dt className="type-eyebrow text-ink-faint">Experience{m.selfReported.includes("experienceYears") && <SelfReported />}</dt><dd className="mt-2 type-figure text-3xl text-ink">{m.experienceYears} years</dd></div>}
          {m.qualifications.length > 0 && (
            <div><dt className="type-eyebrow text-ink-faint">Qualifications{m.selfReported.includes("qualifications") && <SelfReported />}</dt>
              <dd><ul className="mt-2 flex flex-wrap gap-2 text-sm text-ink">{m.qualifications.map((q) => <li key={q} className="rounded-pill border border-line bg-surface px-3 py-1">{q}</li>)}</ul></dd></div>
          )}
          {m.links.length > 0 && (
            <div className="sm:col-span-2"><dt className="type-eyebrow text-ink-faint">Links</dt>
              <dd><ul className="mt-2 flex flex-wrap gap-3 text-sm">{m.links.map((l) => <li key={l.url}>{l.url.startsWith("https://") ? <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline">{l.label}<ArrowUpRight aria-hidden className="size-3.5" /></a> : l.label}</li>)}</ul></dd></div>
          )}
        </dl>

        <div className="space-y-8">
          {baskets.map(([title, list]) => list.length > 0 && (
            <section key={title} aria-label={title} className="space-y-3">
              <h2 className="type-eyebrow text-ink-faint">{title}</h2>
              <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                {list.map((b) => (
                  <li key={`${b.slug}-${b.from}`} className="space-y-1.5 p-4">
                    <div className="flex items-center justify-between gap-3"><Link href={`/baskets/${b.slug}`} className="font-medium text-ink underline-offset-4 hover:underline">{b.name}</Link><StatusBadge {...BASKET_STATUS_LABEL[b.status]} /></div>
                    <p className="text-xs text-ink-muted">{b.role === "lead" ? "Lead" : "Co-manager"} · from {date(b.from)}{b.to && ` to ${date(b.to)}`}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {orgs.map(([title, list]) => list.length > 0 && (
            <section key={title} aria-label={title} className="space-y-3">
              <h2 className="type-eyebrow text-ink-faint">{title}</h2>
              <ul className="space-y-3">
                {list.map((o) => (
                  <li key={`${o.organizationId}-${o.from}`} className="flex items-center gap-3 text-sm text-ink">
                    <Monogram name={o.organizationName ?? "Organization"} />
                    <span><Link href={`/organizations/${o.organizationId}`} className="font-medium text-ink underline-offset-4 hover:underline">{o.organizationName ?? "Organization"}</Link>
                      <span className="block text-xs text-ink-muted">{o.title ?? o.role} · from {date(o.from)}{o.to && ` to ${date(o.to)}`}</span></span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
