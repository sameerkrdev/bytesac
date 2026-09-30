import { ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, publicOrganizationSchema, z } from "@repo/validator";
import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Organization · Bytesac" };

export default async function PublicOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/organizations/${id}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public organization failed: ${res.status}`);
  const org = publicOrganizationSchema.parse(await res.json());
  // Render only catalog fields marked public, whatever the response holds.
  const fields = ORGANIZATION_FIELD_KEYS.filter((k) => ORGANIZATION_FIELDS[k].visibility === "public" && typeof org.profile[k] === "string" && org.profile[k] !== "");

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-6 bg-space px-4 py-10 md:px-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">{String(org.profile.displayName ?? "Organization")}</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-stone">
          <span className="inline-flex items-center gap-1 rounded-lg border border-success/40 px-2 py-0.5 text-xs font-medium text-success"><BadgeCheck aria-hidden className="size-3.5" />Verified by Bytesac</span>
          <span>{org.type === "firm" ? "Firm" : "Individual manager"} · {org.jurisdiction} · verified {new Date(org.verifiedAt).toLocaleDateString()}</span>
        </p>
      </div>
      <Card className="rounded-2xl border-border-dark bg-slate">
        <CardContent>
          <dl className="space-y-4">
            {fields.filter((k) => k !== "displayName").map((k) => (
              <div key={k}>
                <dt className="text-xs text-stone">{ORGANIZATION_FIELDS[k].label}</dt>
                <dd className="whitespace-pre-wrap text-sm text-ivory">
                  {k === "website" ? <a href={String(org.profile[k])} rel="noopener noreferrer nofollow" className="text-mint underline">{String(org.profile[k])}</a> : String(org.profile[k])}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {([["Current team", org.team.current], ["Former members", org.team.former]] as const).map(([title, members]) => members.length > 0 && (
        <section key={title} aria-label={title} className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
          <ul className="space-y-2">
            {members.map((m, i) => (
              <li key={i} className="text-sm text-ivory">
                <span className="font-medium">{m.displayName}</span>
                <span className="text-stone"> · {m.title ? `${m.title}, ` : ""}{m.role[0] + m.role.slice(1).toLowerCase()}{"to" in m && ` · ${new Date(m.from).toLocaleDateString()} to ${new Date(m.to).toLocaleDateString()}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
