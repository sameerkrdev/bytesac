import { ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, publicOrganizationSchema, z } from "@repo/validator";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { API_ORIGIN, apiHeaders } from "@/lib/server-api";
import { Monogram, ProfileHero, VerifiedBadge } from "@/components/layout/profile-hero";

export const metadata: Metadata = { title: "Organization" };

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });

export default async function PublicOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const res = await fetch(`${API_ORIGIN}/v1/public/organizations/${id}`, {
    headers: await apiHeaders(), cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public organization failed: ${res.status}`);
  const org = publicOrganizationSchema.parse(await res.json());
  // Render only catalog fields marked public, whatever the response holds.
  const fields = ORGANIZATION_FIELD_KEYS.filter((k) => ORGANIZATION_FIELDS[k].visibility === "public" && typeof org.profile[k] === "string" && org.profile[k] !== "");
  const name = String(org.profile.displayName ?? "Organization");
  const about = fields.includes("about") ? String(org.profile.about) : null;

  return (
    <div className="space-y-12">
      <ProfileHero name={name} eyebrow="Organization" crumbs={[{ label: "Baskets", href: "/baskets" }, { label: name }]}
        meta={<><VerifiedBadge /><span>{org.type === "firm" ? "Firm" : "Individual manager"} · {org.jurisdiction} · verified {new Date(org.verifiedAt).toLocaleDateString()}</span></>}>
        {about && <p className="type-lede whitespace-pre-wrap text-ink">{about}</p>}
      </ProfileHero>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <dl className="grid content-start gap-x-10 gap-y-8 sm:grid-cols-2">
          {fields.filter((k) => k !== "displayName" && k !== "about").map((k) => (
            <div key={k} className={k === "website" ? undefined : "sm:col-span-2"}>
              <dt className="type-eyebrow text-ink-faint">{ORGANIZATION_FIELDS[k].label}</dt>
              <dd className="mt-2 whitespace-pre-wrap text-ink">
                {k === "website" ? <a href={String(org.profile[k])} rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">{String(org.profile[k])}</a> : String(org.profile[k])}
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-8">
          {org.baskets.length > 0 && (
            <section aria-label="Baskets" className="space-y-3">
              <h2 className="type-eyebrow text-ink-faint">Baskets</h2>
              <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                {org.baskets.map((b) => (
                  <li key={b.slug}><Link href={`/baskets/${b.slug}`} className="flex min-h-14 items-center justify-between gap-3 px-4 text-sm font-medium text-ink hover:bg-surface-muted">{b.name}<ArrowUpRight aria-hidden className="size-4 text-ink-faint" /></Link></li>
                ))}
              </ul>
            </section>
          )}
          {([["Current team", org.team.current], ["Former members", org.team.former]] as const).map(([title, members]) => members.length > 0 && (
            <section key={title} aria-label={title} className="space-y-3">
              <h2 className="type-eyebrow text-ink-faint">{title}</h2>
              <ul className="space-y-3">
                {members.map((m, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-ink">
                    <Monogram name={m.displayName} />
                    <span>
                      <span className="font-medium">{m.displayName}</span>
                      <span className="text-ink-muted"> · {m.title ? `${m.title}, ` : ""}{m.role[0] + m.role.slice(1).toLowerCase()}{"to" in m && ` · ${date(m.from)} to ${date(m.to)}`}</span>
                    </span>
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
