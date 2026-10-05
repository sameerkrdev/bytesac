"use client";

import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, Compass, Flame, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { BasketRail } from "@/components/baskets/basket-rail";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { DownloadApp } from "@/components/marketing/download-app";
import { useMe } from "@/components/me-context";
import { AttentionList, PortfolioSummary, PositionRows } from "@/components/portfolio/summary";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { GlassObject } from "@/components/visual/scenery";
import { api } from "@/lib/api";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The signed-in start page: what you own, what needs you, and where to look next. */
export default function HomePage() {
  const { data: me } = useMe();
  const approved = me?.permissions.includes("create_manager_organization");
  const orgs = me?.organizations ?? [];
  const org = orgs.find((o) => o.status !== "REJECTED") ?? orgs[0];
  const invitations = useQuery({ queryKey: ["invitations"], queryFn: () => api.myInvitations(), retry: false }).data?.invitations ?? [];
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio(), retry: false });
  const collections = useQuery({ queryKey: ["discover", "collections"], queryFn: () => api.getDiscoveryCollections(), retry: false });
  const suggested = useQuery({ queryKey: ["discover", "suggested"], queryFn: () => api.getSuggestedBaskets(), retry: false });
  const p = portfolio.data;
  const missingContacts = me && !["email", "phone"].every((t) => me.contacts.some((c) => c.type === t && c.status === "verified"));

  return (
    <section aria-labelledby="home-title" className="space-y-10 md:space-y-12">
      <header className="space-y-2">
        <p className="type-eyebrow text-ink-faint">{greeting()}</p>
        <h1 id="home-title" className="type-title text-ink">Home</h1>
      </header>

      {missingContacts && (
        <Link href="/profile#contacts" className="flex items-center gap-4 rounded-card border border-info/20 bg-info-soft p-5 text-sm text-ink transition-colors hover:border-info/40">
          <Mail aria-hidden className="size-5 shrink-0 text-info" />
          <span className="flex-1"><span className="block font-medium">Verify your email and phone to invest</span><span className="text-ink-muted">Bytesac uses them for notices about your baskets and the transactions you sign.</span></span>
          <ArrowRight aria-hidden className="size-4 text-ink-muted" />
        </Link>
      )}

      {invitations.map((i) => (
        <Link key={i.membershipId} href={`/invitations/${i.membershipId}`} className="flex min-h-11 items-center gap-4 rounded-card border border-accent/30 bg-surface p-6 transition-colors hover:border-accent">
          <Briefcase aria-hidden className="size-5 shrink-0 text-accent" />
          <span className="flex-1">
            <span className="block type-heading text-ink">Invitation from {i.organization.displayName ?? "an organization"}</span>
            <span className="mt-1 block text-sm text-ink-muted">Join as {MEMBERSHIP_ROLE_LABEL[i.role]}</span>
          </span>
          <ArrowRight aria-hidden className="size-4 text-ink-muted" />
        </Link>
      ))}

      {portfolio.isPending ? <LoadingState rows={2} /> : portfolio.isError ? <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} /> : p && p.positions.length > 0 ? (
        <>
          <PortfolioSummary portfolio={p} />
          <AttentionList portfolio={p} />
          <section aria-labelledby="positions-title" className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <h2 id="positions-title" className="type-heading text-ink">Your baskets</h2>
              <Link href="/portfolio" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">Open portfolio</Link>
            </div>
            <PositionRows positions={p.positions} />
          </section>
        </>
      ) : (
        <section aria-label="Get started" className="atmosphere relative grid items-center gap-8 overflow-hidden rounded-shell border border-line p-8 sm:p-10 md:grid-cols-[1fr_auto]">
          <div className="max-w-lg space-y-4">
            <Compass aria-hidden className="size-6 text-ink-muted" />
            <h2 className="type-title text-ink">Find your first strategy</h2>
            <p className="text-ink-muted">Research baskets from verified organizations. When you invest, you’ll see every step and sign each one in your own wallet.</p>
            <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Discover baskets<ArrowRight /></Link>
          </div>
          <GlassObject name="glass-portfolio-prism" className="hidden w-44 md:block" sizes="176px" />
        </section>
      )}

      <div className="space-y-12">
        {suggested.data && (
          <BasketRail id="suggested-title" title="Suggested for you" icon={<Compass aria-hidden className="size-4 text-ink-muted" />} items={suggested.data.items} href="/baskets"
            description={suggested.data.basis === "your_categories" ? "In the categories you already hold, excluding baskets you own." : "Recently published baskets you don’t hold yet."} />
        )}
        <BasketRail id="featured-title" title="Featured" icon={<Sparkles aria-hidden className="size-4 text-accent" />} items={collections.data?.featured ?? []} href="/baskets"
          description="Chosen by the Bytesac team. Being featured is not advice or a view on future returns." />
        <BasketRail id="trending-title" title="Trending" icon={<Flame aria-hidden className="size-4 text-warning" />} items={collections.data?.trending ?? []} href="/baskets"
          description="Most new investors over the last 30 days." />
        <p className="text-xs text-ink-faint">Returns and volatility on cards are simulated model performance, not actual investor results.</p>
      </div>

      <DownloadApp headingLevel="h2" />

      <section aria-label="For managers" className="border-t border-line pt-8">
        {org ? (
          <Link href="/organization" className="flex min-h-11 items-center gap-4 rounded-card border border-line bg-surface p-6 transition-colors hover:border-line-strong">
            <Briefcase aria-hidden className="size-5 shrink-0 text-ink-muted" />
            <span className="flex-1"><span className="block type-heading text-ink">Your organization</span>
              <span className="mt-2 block"><StatusBadge {...(org.membershipStatus === "ACTIVE" ? ORGANIZATION_STATUS_LABEL[org.status] : MEMBERSHIP_STATUS_LABEL[org.membershipStatus])} /></span></span>
            <ArrowRight aria-hidden className="size-4 text-ink-muted" />
          </Link>
        ) : approved ? (
          <div className="space-y-3 rounded-card border border-line bg-surface p-6">
            <p className="text-base text-ink">You&apos;re approved to create a manager organization.</p>
            <Link href="/organization" className={buttonVariants({ variant: "secondary" })}>Create your organization</Link>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Run strategies professionally? <Link href="/managers/apply" className="text-ink underline underline-offset-4">Become a fund manager</Link></p>
        )}
      </section>
    </section>
  );
}
