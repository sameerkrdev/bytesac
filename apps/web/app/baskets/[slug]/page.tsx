import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL, REVIEW_FREQUENCY_LABEL, SECTOR_LABEL } from "@repo/app-core/basket-status";
import { formatBps, formatFraction } from "@repo/app-core/format";
import { SESSION_COOKIE, publicBasketResponseSchema, type BasketStatus, type PublicBasketDetail } from "@repo/validator";
import { AlertTriangle, PenLine, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { BasketView } from "@/components/baskets/basket-view";
import { FileList } from "@/components/baskets/basket-files";
import { BASKET_SECTIONS } from "@/components/baskets/sections";
import { PerformanceChart } from "@/components/baskets/performance-chart";
import { DiffSummary } from "@/components/baskets/version-history";
import { EligibilityNotices } from "@/components/eligibility/notices";
import { InvestButton } from "@/components/invest/invest-button";
import { Breadcrumb } from "@/components/layout/page-layout";
import { StatusBadge } from "@/components/status-badge";
import { feeText } from "@/lib/fees";
import { GlassObject } from "@/components/visual/scenery";
import { WeightDiff } from "@/components/visual/weight-diff";

export const metadata: Metadata = { title: "Basket" };

const NOTICE: Partial<Record<BasketStatus, string>> = {
  PAUSED: "This basket is paused by its manager or by Bytesac.",
  REASSIGNMENT_REQUIRED: "The basket's lead manager left. A new lead needs approval from Bytesac.",
  RETIREMENT_PENDING: "The manager asked to retire this basket. Bytesac has not decided yet.",
  RETIRED: "This basket is retired.",
};

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The headline return: 1-year net if the basket is old enough, otherwise since launch, otherwise "New". */
function headline(m: PublicBasketDetail["metrics"]): { label: string; value: string; negative: boolean } {
  if (m.available && m.net.y1 !== null) return { label: "1y net · simulated", value: formatFraction(m.net.y1, true), negative: Number(m.net.y1) < 0 };
  if (m.available && m.net.sinceLaunch !== null) return { label: "Since launch · simulated", value: formatFraction(m.net.sinceLaunch, true), negative: Number(m.net.sinceLaunch) < 0 };
  return { label: "Performance", value: "New", negative: false };
}

function Index({ files }: { files: boolean }) {
  const items = [{ id: "performance", label: "Performance" }, ...BASKET_SECTIONS, ...(files ? [{ id: "documents", label: "Documents" }] : []), { id: "history", label: "Version history" }, { id: "team", label: "Managers" }];
  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <p className="type-eyebrow text-ink-faint">On this page</p>
      <ul className="mt-3 space-y-0.5 border-l border-line">
        {items.map((s) => <li key={s.id}><a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-ink-muted transition-colors hover:border-ink hover:text-ink">{s.label}</a></li>)}
      </ul>
    </nav>
  );
}

export default async function PublicBasketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The session (when there is one) lets the API say which assets this viewer may buy.
  const session = (await cookies()).get(SESSION_COOKIE);
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/baskets/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json", ...(session ? { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.value)}` } : {}) }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public basket failed: ${res.status}`);
  const b = publicBasketResponseSchema.parse(await res.json());
  if ("redirectTo" in b) permanentRedirect(`/baskets/${b.redirectTo}`);

  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const symbols = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, a.symbol]));
  const notice = NOTICE[b.status];
  const h = headline(b.metrics);
  const lead = b.managers.find((m) => m.role === "lead" && m.to === null);
  const latest = b.versionHistory[0];
  const latestRows = latest && b.versionHistory.length > 1 ? [
    ...latest.diff.changed.map((c) => ({ key: c.instrumentId, label: symbols[c.instrumentId] ?? "Asset", fromBps: c.fromBps, toBps: c.toBps })),
    ...latest.diff.added.map((c) => ({ key: c.instrumentId, label: symbols[c.instrumentId] ?? "Asset", fromBps: null, toBps: c.weightBps })),
    ...latest.diff.removed.map((c) => ({ key: c.instrumentId, label: symbols[c.instrumentId] ?? "Removed asset", fromBps: c.weightBps, toBps: null })),
  ] : [];

  return (
    <div className="space-y-10">
      <header className="atmosphere relative isolate overflow-hidden rounded-shell border border-line px-6 pt-6 pb-8 sm:px-10 sm:pt-8 sm:pb-12">
        <GlassObject name="glass-allocation-ring" className="absolute -top-6 -right-10 -z-10 hidden w-80 opacity-80 xl:block" sizes="320px" />
        <Breadcrumb items={[{ label: "Baskets", href: "/baskets" }, { label: b.version.name }]} />
        <p className="mt-8 type-eyebrow text-ink-muted">{BASKET_CATEGORY_LABEL[b.version.category]}</p>
        <h1 className="mt-3 max-w-3xl type-display text-ink">{b.version.name}</h1>
        {b.version.shortDescription && <p className="mt-4 max-w-2xl type-lede text-ink-muted">{b.version.shortDescription}</p>}
        <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
          <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
          <span>Version {b.version.versionNumber} · published {date(b.version.publishedAt)}</span>
          <span aria-hidden>·</span>
          <span>by <Link href={`/organizations/${b.organization.id}`} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">{b.organization.displayName ?? "Organization"}</Link></span>
          {lead && <><span aria-hidden>·</span><span>Lead: {lead.displayName}</span></>}
        </p>
        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-ink/10 pt-6 sm:grid-cols-4">
          <div><dt className="text-xs text-ink-muted">Minimum</dt><dd className="mt-1 type-figure text-3xl text-ink">{b.version.minimumInvestmentUsdc ?? "—"}<span className="ml-1 text-base text-ink-muted">USDC</span></dd></div>
          <div><dt className="text-xs text-ink-muted">Entry fee</dt><dd className="mt-1 text-lg text-ink">{feeText(b.version.fees.entry)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Review</dt><dd className="mt-1 text-lg text-ink">{REVIEW_FREQUENCY_LABEL[b.version.rebalance.reviewFrequency]}</dd></div>
          <div><dt className="text-xs text-ink-muted">{h.label}</dt><dd className={`mt-1 type-figure text-3xl ${h.negative ? "text-danger" : "text-ink"}`}>{h.value}</dd></div>
        </dl>
      </header>

      {(notice || b.hasAssetWarning || b.eligibility.requirements) && (
        <div className="space-y-3">
          {notice && <p role="status" className="flex gap-3 rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm text-ink"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />{notice}</p>}
          {b.hasAssetWarning && <p className="flex gap-3 rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm text-ink"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />One or more assets in this basket were paused or deprecated in the registry after publication.</p>}
          <EligibilityNotices eligibility={b.eligibility} names={names} />
        </div>
      )}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] xl:gap-16">
        <div className="min-w-0 space-y-14">
          <div id="performance" className="scroll-mt-28"><PerformanceChart performance={b.performance} metrics={b.metrics} label={b.label} /></div>

          <BasketView content={b.version} disclosures={b.disclosures} platformFee={b.platformFee}
            allocation={b.allocation.map((a) => {
              const p = a.prices.find((x) => x.status === "ok" && x.value !== null);
              return {
                ...a, key: a.instrumentId,
                price: p ? <>{p.value} {p.currency}{p.stale && <span className="ml-2 rounded-pill bg-warning-soft px-2 py-0.5 text-[0.6875rem] text-warning">Stale</span>}</> : "Price unavailable",
              };
            })} />

          {(b.sectors.length > 0 || b.tags.length > 0) && (
            <section aria-label="Sectors and tags" className="space-y-5 border-t border-line pt-10">
              <h2 className="type-heading text-ink">Sectors</h2>
              <ul className="space-y-3">
                {b.sectors.map((s) => (
                  <li key={s.sector} className="space-y-1.5">
                    <p className="flex justify-between text-sm text-ink"><span>{SECTOR_LABEL[s.sector]}</span><span className="font-mono text-xs text-ink-muted">{formatBps(s.bps)}</span></p>
                    <div aria-hidden className="h-1.5 rounded-pill bg-surface-sunken"><div className="h-1.5 rounded-pill bg-data2" style={{ width: `${Math.min(s.bps / 100, 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
              {b.tags.length > 0 && <p className="flex flex-wrap gap-2 text-sm">{b.tags.map((t) => <span key={t.key} className="rounded-pill border border-line bg-surface px-3 py-1 text-ink-muted">{t.label}</span>)}</p>}
            </section>
          )}

          {b.files.length > 0 && (
            <section id="documents" aria-labelledby="documents-title" className="scroll-mt-28 space-y-6 border-t border-line pt-10">
              <div className="space-y-2">
                <p className="type-eyebrow text-ink-faint">From the managers · version {b.version.versionNumber}</p>
                <h2 id="documents-title" className="type-heading text-ink">Documents</h2>
                <p className="max-w-2xl text-sm text-ink-muted">Files published with this version and reviewed with it. They are the organization&apos;s own material, not advice from Bytesac.</p>
              </div>
              <FileList files={b.files} />
            </section>
          )}

          <section id="history" aria-label="Version history" className="scroll-mt-28 space-y-6 border-t border-line pt-10">
            <div className="space-y-2">
              <p className="type-eyebrow text-ink-faint">Published versions never change</p>
              <h2 className="type-heading text-ink">Version history</h2>
            </div>
            {latestRows.length > 0 && (
              <div className="rounded-card border border-line bg-surface p-6">
                <p className="mb-4 text-sm text-ink-muted">What changed in version {latest!.versionNumber}</p>
                <WeightDiff rows={latestRows} fromLabel={`Version ${latest!.versionNumber - 1}`} toLabel={`Version ${latest!.versionNumber}`} />
              </div>
            )}
            <ol className="relative space-y-8 pl-8 before:absolute before:top-2 before:bottom-2 before:left-[0.4375rem] before:w-px before:bg-line">
              {b.versionHistory.map((v, i) => (
                <li key={v.versionNumber} className="relative space-y-2">
                  <span aria-hidden className={`absolute top-1.5 -left-8 size-3.5 rounded-full border-2 ${i === 0 ? "border-primary bg-primary" : "border-line-strong bg-canvas"}`} />
                  <p className="text-sm font-medium text-ink">Version {v.versionNumber} <span className="font-normal text-ink-muted">· {date(v.publishedAt)}{i === 0 && " · current"}</span></p>
                  {v.rationale && <p className="text-sm whitespace-pre-wrap text-ink-muted">{v.rationale}</p>}
                  <DiffSummary diff={v.diff} names={names} />
                </li>
              ))}
            </ol>
          </section>

          <div id="team" className="scroll-mt-28 grid gap-6 border-t border-line pt-10 sm:grid-cols-2">
            {([["Current managers", b.managers.filter((m) => m.to === null)], ["Former managers", b.managers.filter((m) => m.to !== null)]] as const).map(([title, list]) => list.length > 0 && (
              <section key={title} aria-label={title} className="space-y-4">
                <h2 className="type-eyebrow text-ink-faint">{title}</h2>
                <ul className="space-y-3">
                  {list.map((m, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-ink">
                      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-ink-muted">{m.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
                      <span>
                        {m.handle ? <Link href={`/managers/${m.handle}`} className="font-medium text-ink underline-offset-4 hover:underline">{m.displayName}</Link> : <span className="font-medium">{m.displayName}</span>}
                        <span className="text-ink-muted"> · {m.role === "lead" ? "Lead" : "Co-manager"}</span>
                        <span className="block text-xs text-ink-faint">from {date(m.from)}{m.to && ` to ${date(m.to)}`}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <aside id="invest" aria-label="Invest" className="order-first scroll-mt-24 lg:order-none">
          <div className="space-y-6 lg:sticky lg:top-28">
            <div className="rounded-card border border-line bg-surface p-6 shadow-soft">
              <p className="type-eyebrow text-ink-faint">Invest in this strategy</p>
              <p className="mt-3 text-sm text-ink-muted">Minimum <span className="text-ink">{b.version.minimumInvestmentUsdc ?? "—"} USDC</span>{b.version.minimumIncrementUsdc && <> · steps of {b.version.minimumIncrementUsdc}</>}. Funded in USDC on Solana.</p>
              <div className="mt-5 [&_a]:w-full [&_button]:w-full">
                <InvestButton slug={slug} name={b.version.name} minimumUsdc={b.version.minimumInvestmentUsdc} incrementUsdc={b.version.minimumIncrementUsdc} mode="page" />
              </div>
              <ul className="mt-6 space-y-3 border-t border-line pt-5 text-xs text-ink-muted">
                <li className="flex gap-2.5"><Wallet aria-hidden className="size-4 shrink-0 text-ink-faint" />Assets settle in your own wallets.</li>
                <li className="flex gap-2.5"><PenLine aria-hidden className="size-4 shrink-0 text-ink-faint" />You review the full plan and sign each step.</li>
              </ul>
            </div>
            <Index files={b.files.length > 0} />
          </div>
        </aside>
      </div>

    </div>
  );
}
