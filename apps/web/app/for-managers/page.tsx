import { MEMBERSHIP_ROLE_LABEL } from "@repo/app-core/membership-status";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/layout/app-shell";
import { Chapter, PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/motion/reveal";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "For managers", description: "Run strategy baskets on Bytesac as a verified organization: draft, submit for review, publish versions and explain every change." };

const ROLES: { role: "OWNER" | "ADMIN" | "MANAGER" | "ANALYST" | "VIEWER"; can: string }[] = [
  { role: "OWNER", can: "Everything, including the organization profile, payout wallet, admins and earnings." },
  { role: "ADMIN", can: "Members, baskets and earnings." },
  { role: "MANAGER", can: "Create and manage baskets they are assigned to." },
  { role: "ANALYST", can: "Read the organization and its baskets." },
  { role: "VIEWER", can: "Read the organization." },
];

const LIFECYCLE = [
  ["Draft", "Write the thesis, choose approved assets, set target weights, bands, rebalancing and fees."],
  ["In review", "Submit. Bytesac checks assets, allocation, communication, managers, fees and operations."],
  ["Changes required", "Reviewers comment by section. Edit and resubmit."],
  ["Approved → Published", "A manager with publish rights makes it live. A published version never changes."],
  ["New version", "Every change is a new version with a rationale and a diff. Investors choose whether to follow it."],
];

export default function ForManagers() {
  return (
    <PublicShell bare>
      <SmoothScroll />
      <PageHero eyebrow="For strategy managers" object="glass-portfolio-prism" lines={["Build strategies", <span key="b" className="text-ink-muted">as an organization.</span>]}
        lede="Bytesac gives verified organizations a professional workspace to design, review, publish and maintain investment baskets — and a clear, honest channel to the investors who follow them.">
        <Link href="/managers/apply" className={buttonVariants({ size: "lg" })}>Apply<ArrowRight /></Link>
        <Link href="/managers/status" className={buttonVariants({ variant: "glass", size: "lg" })}>Check an application</Link>
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 pb-28 sm:px-6 lg:px-10">
        <Chapter n="01" title="The organization owns the basket">
          <p>Baskets belong to verified organizations, never to an individual or a personal wallet. Managers are assigned to a basket as lead or co-manager; when people change, the basket stays with the organization and the history stays on record.</p>
        </Chapter>

        <Chapter n="02" title="Roles your team can hold" aside={
          <dl className="divide-y divide-line rounded-card border border-line bg-surface">
            {ROLES.map((r) => (
              <div key={r.role} className="grid grid-cols-[6rem_1fr] gap-3 px-5 py-4 text-sm">
                <dt className="font-medium text-ink">{MEMBERSHIP_ROLE_LABEL[r.role]}</dt>
                <dd className="text-ink-muted">{r.can}</dd>
              </div>
            ))}
          </dl>
        }>
          <p>Permissions follow the role, and basket-level flags (edit, submit, publish, lifecycle, assign) refine what each manager can do on each basket. Every permission is enforced by Bytesac’s servers, not just hidden in the interface.</p>
        </Chapter>

        <Chapter n="03" title="From draft to published version">
          <ol className="space-y-4">
            {LIFECYCLE.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="font-mono text-xs text-ink-faint">0{i + 1}</span>
                <span><strong>{t}.</strong> {d}</span>
              </li>
            ))}
          </ol>
        </Chapter>

        <Chapter n="04" title="Fees you set, shown to every investor">
          <p>Set an entry fee and a rebalance fee — a percentage with an optional cap, or a fixed amount. They are collected to your organization’s verified payout wallet as part of the investor’s signed fee step. Management and subscription fees can be disclosed but are not collected in this release.</p>
        </Chapter>

        <Chapter n="05" title="How to join">
          <p>Apply with your details. After screening, you create your organization, add its documents and prove control of the payout wallet. Once Bytesac verifies the organization, you can invite your team and start drafting baskets.</p>
        </Chapter>
        <Reveal className="mt-6 flex flex-wrap gap-2 border-t border-line pt-10">
          <Link href="/managers/apply" className={buttonVariants({ size: "lg" })}>Start an application<ArrowRight /></Link>
        </Reveal>
      </div>
    </PublicShell>
  );
}
