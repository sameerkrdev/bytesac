import { HEADLINE_LABEL } from "@repo/app-core/portfolio-actions";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/layout/app-shell";
import { Chapter, PageHero } from "@/components/marketing/page-hero";
import { ClosingCta } from "@/components/marketing/sections";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "How it works", description: "How Bytesac takes you from discovering a strategy basket to owning it in your own wallet and deciding on every update." };

const LAYERS = [
  { t: "Strategy target", d: "What the basket should hold, set by the organization in a published version.", e: "BTC 35% · ETH 30% · SOL 20% · …" },
  { t: "Your basket allocation", d: "How Bytesac attributes your holdings to each basket you invested in — a ledger, not a wallet.", e: "Core Crypto Index → 0.0125 BTC, 0.31 ETH, …" },
  { t: "Verified holdings", d: "What your wallets actually hold, read from each chain. This is the evidence; the other two are intentions and bookkeeping.", e: "Solana wallet · EVM wallet · Bitcoin address" },
];

export default function HowItWorks() {
  return (
    <PublicShell bare>
      <SmoothScroll />
      <PageHero eyebrow="How it works" object="glass-allocation-ring" lines={["From first look", <span key="b" className="text-ink-muted">to final say.</span>]}
        lede="Bytesac turns a strategy into a set of transactions you can read, sign and track — and keeps asking you before anything changes.">
        <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Explore baskets<ArrowRight /></Link>
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-10">
        <Chapter n="01" title="Discover and research">
          <p>Browse published baskets, filter by assets, weights, fees, minimums and review frequency — or describe what you want in a sentence. The AI search only turns your words into <strong>filters you can see and edit</strong>; it never writes recommendations. Queries are processed by Google Gemini.</p>
          <p>Each basket page carries the thesis, target weights and bands, risks, fees, the organization and managers behind it, and every published version with what changed.</p>
        </Chapter>

        <Chapter n="02" title="Three things that are never the same" aside={
          <ol className="space-y-3">
            {LAYERS.map((l, i) => (
              <li key={l.t} className="rounded-tile border border-line bg-surface p-4">
                <p className="type-eyebrow text-ink-faint">Layer {i + 1}</p>
                <p className="mt-2 font-medium text-ink">{l.t}</p>
                <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">{l.e}</p>
              </li>
            ))}
          </ol>
        }>
          {LAYERS.map((l) => <p key={l.t}><strong>{l.t}.</strong> {l.d}</p>)}
          <p>A manager saying “35% BTC” never means your wallet holds 35% BTC. Bytesac shows the three side by side so you can see the difference.</p>
        </Chapter>

        <Chapter n="03" title="Invest with the whole plan in view">
          <p>Choose an amount at or above the basket minimum. Investments are funded in <strong>USDC on Solana</strong>. Before you sign anything you see the split per asset and network, the expected slippage (1% by default, 3% at most), every fee — network fee, manager fee to the organization, platform fee — and what you are authorizing.</p>
          <p>Quotes expire after about a minute; if prices move you confirm the new estimate. To invest you need a verified email and phone, and some tokenized assets need a short eligibility declaration.</p>
        </Chapter>

        <Chapter n="04" title="Authorize each step">
          <p>An investment is an operation made of steps. You sign each one in your own wallet, at that moment, against the plan you reviewed. EVM approvals are for the exact amount. There are no standing allowances and no session keys.</p>
          <p>If something stops halfway, that is shown as it is — <strong>partially completed</strong> — with the choice to continue or stop. An outcome that is unknown is checked, never blindly retried.</p>
        </Chapter>

        <Chapter n="05" title="Monitor in plain language" aside={
          <div className="flex flex-wrap gap-2">
            {Object.entries(HEADLINE_LABEL).map(([k, v]) => <StatusBadge key={k} tone={v.tone} label={v.label} />)}
          </div>
        }>
          <p>Each position has one headline that tells you whether anything needs you: aligned, drifted, a custom allocation, a new version, an operation in progress, a plan left incomplete, or a repair needed. Holdings are reconciled from the chain, and stale data is labelled as stale.</p>
        </Chapter>

        <Chapter n="06" title="Review updates. Participate or skip.">
          <p>Managers change a strategy by publishing a new version that Bytesac reviewed. You are notified and shown the rationale, the version diff and your current weights next to the new target.</p>
          <p><strong>Participate</strong> and Bytesac plans from what you actually hold now to the new target; you sign it like any other operation. <strong>Skip</strong> and nothing trades — you stay on your applied version and can review the update later.</p>
        </Chapter>

        <Chapter n="07" title="When your wallet changes outside Bytesac">
          <p>Your assets are yours, so you can move or sell them at any time. Bytesac notices and explains what changed — which asset, when, what you hold against the target — and offers the right next step: rebalance, keep a custom allocation, revert to the target, or repair a shortfall. It never buys an asset just because a strategy expects it.</p>
        </Chapter>
      </div>
      <ClosingCta />
    </PublicShell>
  );
}
