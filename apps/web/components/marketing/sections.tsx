"use client";

import type { DiscoverySearchItem } from "@repo/validator";
import { ArrowRight, Building2, Check, FileSearch, Layers, PenLine, ShieldCheck, Wallet } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { BasketCard } from "@/components/baskets/basket-card";
import { LineReveal, Parallax, Reveal, Stagger } from "@/components/motion/reveal";
import { buttonVariants } from "@/components/ui/button";
import { AllocationLegend, AllocationRing } from "@/components/visual/allocation-ring";
import { ChainBadge } from "@/components/visual/chain-badge";
import { ExampleBasketScreen } from "@/components/visual/phone-screens";
import { GlassObject, HandPhone, Sky } from "@/components/visual/scenery";
import { WeightDiff } from "@/components/visual/weight-diff";
import { cn } from "@/lib/utils";

const wrap = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10";

function SectionIntro({ eyebrow, title, id, children, className }: { eyebrow: string; title: ReactNode; id: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-2xl space-y-5", className)}>
      <Reveal as="p" className="type-eyebrow text-ink-faint">{eyebrow}</Reveal>
      <Reveal delay={0.05}><h2 id={id} className="type-display text-ink">{title}</h2></Reveal>
      {children && <Reveal delay={0.1} className="type-lede text-ink-muted">{children}</Reveal>}
    </div>
  );
}

/** The product thesis, revealed one line at a time. */
export function Statement() {
  return (
    <section aria-label="Why Bytesac" className={cn(wrap, "py-28 md:py-44")}>
      <div className="mx-auto max-w-4xl text-center">
        <Reveal className="mx-auto mb-10 size-20"><GlassObject name="glass-allocation-ring" className="size-full object-contain" sizes="80px" /></Reveal>
        <LineReveal as="p" inView className="type-title text-ink" lineClassName="[&>em]:text-ink-faint [&>em]:not-italic" lines={[
          "Most people don’t need another trading screen.",
          <em key="b">They need a strategy they understand,</em>,
          <em key="c">assets they control,</em>,
          "and the final say on every change.",
        ]} />
      </div>
    </section>
  );
}

const JOURNEY = [
  { n: "01", title: "Discover", body: "Browse baskets from verified organizations — or describe what you want in plain words and get structured filters back." },
  { n: "02", title: "Research", body: "Read the thesis, the target weights, the risks, the fees and every past version before you put in a dollar." },
  { n: "03", title: "Invest", body: "Choose an amount. See exactly how it splits across assets and networks, with every fee listed up front." },
  { n: "04", title: "Authorize", body: "Approve each transaction in your own wallet, against the plan you reviewed. Nothing moves without your signature." },
  { n: "05", title: "Own", body: "The assets land in your wallets. Bytesac tracks them against the strategy — it never holds them." },
  { n: "06", title: "Monitor", body: "One portfolio view across baskets, assets and networks, with drift and anything that needs you explained in plain language." },
  { n: "07", title: "Review", body: "When a manager publishes a new version, you see what changed and why — side by side with what you hold now." },
  { n: "08", title: "Choose", body: "Participate and sign the rebalance, or skip it. Skipping never trades; your holdings stay as they are." },
];

/** The investor journey as a sticky heading beside a list whose progress line fills as you read. */
export function Journey() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const scaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section aria-labelledby="journey-title" className="border-t border-line bg-surface py-28 md:py-40">
      <div className={cn(wrap, "grid gap-16 lg:grid-cols-12")}>
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-32">
            <SectionIntro id="journey-title" eyebrow="How it works" title="From first look to final say.">
              Eight steps, and you are in control of every one that touches your money.
            </SectionIntro>
            <Reveal delay={0.2} className="mt-8"><Link href="/how-it-works" className={buttonVariants({ variant: "secondary" })}>The full walkthrough<ArrowRight /></Link></Reveal>
          </div>
        </div>
        <ol ref={ref} className="relative lg:col-span-6 lg:col-start-7">
          <span aria-hidden className="absolute top-2 bottom-2 left-[1.15rem] w-px bg-line" />
          <motion.span aria-hidden className="absolute top-2 bottom-2 left-[1.15rem] w-px origin-top bg-primary" style={reduce ? undefined : { scaleY }} />
          {JOURNEY.map((s) => (
            <Reveal as="li" key={s.n} className="relative grid grid-cols-[2.5rem_1fr] gap-5 pb-12 last:pb-0" amount={0.6}>
              <span className="relative z-10 grid size-9 place-items-center rounded-full border border-line-strong bg-surface font-mono text-[0.6875rem] text-ink">{s.n}</span>
              <div className="space-y-2 pt-1">
                <h3 className="text-xl font-normal tracking-tight text-ink">{s.title}</h3>
                <p className="max-w-md text-ink-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Live published baskets from the discovery API (hidden when there are none). */
export function BasketRail({ items }: { items: DiscoverySearchItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="rail-title" className="py-28 md:py-40">
      <div className={cn(wrap, "flex flex-wrap items-end justify-between gap-6")}>
        <SectionIntro id="rail-title" eyebrow="Live on Bytesac" title="Strategies you can research today." />
        <Reveal><Link href="/baskets" className={buttonVariants({ variant: "secondary" })}>All baskets<ArrowRight /></Link></Reveal>
      </div>
      <div className="mt-14 overflow-x-auto pb-6 [scrollbar-width:thin] [scroll-padding-inline:1rem] snap-x snap-mandatory">
        <Stagger as="ul" item="li" itemClassName="w-[min(84vw,21rem)] shrink-0 snap-start" className="flex w-max gap-4 px-4 sm:px-6 lg:px-[max(2.5rem,calc((100vw-80rem)/2+2.5rem))]">
          {items.slice(0, 6).map((b) => <BasketCard key={b.slug} b={b} />)}
        </Stagger>
      </div>
      <p className={cn(wrap, "text-xs text-ink-faint")}>1-year figures are simulated model performance, not actual investor results.</p>
    </section>
  );
}

const RESEARCH_SLICES = [
  { key: "btc", label: "Bitcoin", bps: 3000 }, { key: "eth", label: "Ether", bps: 2500 }, { key: "tbill", label: "Tokenized T-bills", bps: 2500 },
  { key: "sol", label: "Solana", bps: 1000 }, { key: "gold", label: "Tokenized gold", bps: 1000 },
];

/** What "research" means: a bento of the parts of a basket an investor reads before investing. Example content, labelled. */
export function Research() {
  return (
    <section aria-labelledby="research-title" className="border-t border-line py-28 md:py-40">
      <div className={wrap}>
        <SectionIntro id="research-title" eyebrow="Research before you invest" title="A basket is a strategy, not a list of tokens.">
          Every basket carries its objective, thesis, target weights, risks, fees and full version history — written by the organization that runs it and reviewed by Bytesac before it goes live.
        </SectionIntro>
        <div className="mt-16 grid gap-4 md:grid-cols-6">
          <Reveal className="rounded-card border border-line bg-surface p-7 md:col-span-4 md:row-span-2">
            <p className="type-eyebrow text-ink-faint">Example · target allocation</p>
            <div className="mt-6 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
              <AllocationRing slices={RESEARCH_SLICES} size={220} thickness={20} label="Example target allocation">
                <div><p className="type-figure text-3xl text-ink">5</p><p className="text-xs text-ink-muted">assets</p></div>
              </AllocationRing>
              <AllocationLegend slices={RESEARCH_SLICES} />
            </div>
            <p className="mt-6 text-sm text-ink-muted">Each weight has a band. When holdings drift outside it, you are told — and you decide whether to rebalance.</p>
          </Reveal>
          <Reveal as="article" delay={0.06} className="rounded-card border border-line bg-surface p-7 md:col-span-2">
            <FileSearch aria-hidden className="size-5 text-ink-faint" />
            <h3 className="mt-6 text-lg font-normal tracking-tight text-ink">Thesis &amp; objective</h3>
            <p className="mt-2 text-sm text-ink-muted">Why the strategy exists, who it is for, and the horizon it is built around.</p>
          </Reveal>
          <Reveal as="article" delay={0.12} className="rounded-card border border-line bg-surface p-7 md:col-span-2">
            <Layers aria-hidden className="size-5 text-ink-faint" />
            <h3 className="mt-6 text-lg font-normal tracking-tight text-ink">Every version, kept</h3>
            <p className="mt-2 text-sm text-ink-muted">Published versions never change. Updates become new versions, each with a rationale and a diff.</p>
          </Reveal>
          <Reveal as="article" delay={0.18} className="rounded-card border border-line bg-surface p-7 md:col-span-3">
            <ShieldCheck aria-hidden className="size-5 text-ink-faint" />
            <h3 className="mt-6 text-lg font-normal tracking-tight text-ink">Risks, in plain language</h3>
            <p className="mt-2 text-sm text-ink-muted">Strategy risks, liquidity notes, known limitations and conflicts of interest — before the invest button, not after.</p>
          </Reveal>
          <Reveal as="article" delay={0.24} className="rounded-card border border-line bg-surface p-7 md:col-span-3">
            <Building2 aria-hidden className="size-5 text-ink-faint" />
            <h3 className="mt-6 text-lg font-normal tracking-tight text-ink">Who runs it</h3>
            <p className="mt-2 text-sm text-ink-muted">Baskets belong to verified organizations, not individuals. You can see the team, the lead manager and its history.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const CUSTODY_FLOW = [
  { icon: Wallet, title: "Your wallet", body: "Assets stay in wallets you control — Solana for settlement, plus your linked EVM and Bitcoin addresses." },
  { icon: FileSearch, title: "Review the plan", body: "See every transaction: which network, which wallet, which amounts and every fee." },
  { icon: PenLine, title: "You sign each step", body: "Approvals are for the exact amount. No standing allowances, no session keys." },
  { icon: Layers, title: "On-chain execution", body: "Trades settle on chain. Partial completion is shown honestly, step by step." },
  { icon: Check, title: "Reconciled", body: "Holdings are read back from the chain, not assumed from a plan." },
];

/** The custody principle, on an inverted surface. Wording follows ADR-013: no absolute security claims. */
export function SelfCustody() {
  return (
    <section aria-labelledby="custody-title" className="relative isolate overflow-hidden py-28 md:py-40">
      <div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_80%_20%,var(--c-sky3),transparent_70%),radial-gradient(60%_50%_at_10%_90%,var(--c-sky2),transparent_70%)] opacity-70" />
        <div className={cn(wrap, "grid items-center gap-16 lg:grid-cols-12")}>
          <div className="lg:col-span-6">
            <Reveal as="p" className="type-eyebrow text-ink-faint">Self-custody by design</Reveal>
            <LineReveal id="custody-title" as="h2" inView className="mt-5 type-display text-ink" lines={["Your assets.", "Your wallet.", "Your authorization.", <span key="d" className="text-ink-muted">Your decision.</span>]} />
            <Reveal delay={0.2} className="mt-8 max-w-lg type-lede text-ink-muted">
              Bytesac is not a place you deposit money. It helps you research a strategy and build the exact transactions to follow it — then waits for your signature.
            </Reveal>
          </div>
          <Parallax speed={50} className="lg:col-span-5 lg:col-start-8">
            <GlassObject name="glass-wallet" className="mx-auto w-full max-w-md drop-shadow-[0_40px_60px_rgba(0,0,0,0.45)]" />
          </Parallax>
        </div>
        <div className={cn(wrap, "mt-20")}>
          <Stagger as="ol" item="li" itemClassName="glass h-full rounded-card p-5" className="grid gap-3 md:grid-cols-5">
            {CUSTODY_FLOW.map((s, i) => (
              <div key={s.title}>
                <div className="flex items-center justify-between">
                  <s.icon aria-hidden className="size-5 text-ink-muted" />
                  <span className="font-mono text-[0.6875rem] text-ink-faint">0{i + 1}</span>
                </div>
                <h3 className="mt-8 text-base font-medium text-ink">{s.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
              </div>
            ))}
          </Stagger>
          <Reveal className="mt-10 max-w-3xl text-sm text-ink-faint">
            Bytesac never holds your private keys or your funds. To keep fees simple it may pay network gas for some steps and co-sign Solana transactions as fee payer — only for the exact transaction you reviewed, and you are charged for that gas as a listed fee.{" "}
            <Link href="/self-custody" className="text-ink underline-offset-4 hover:underline">What you sign, and what we sign</Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** Versioned updates with a participate/skip choice; illustrative rows. */
export function StrategyUpdates() {
  return (
    <section aria-labelledby="updates-title" className="py-28 md:py-44">
      <div className={cn(wrap, "grid items-start gap-16 lg:grid-cols-12")}>
        <div className="lg:col-span-5">
          <SectionIntro id="updates-title" eyebrow="When the strategy changes" title="Managers publish. You decide.">
            A manager can change the strategy only by publishing a new, reviewed version. Your portfolio doesn’t move until you review the change and sign it — or skip it.
          </SectionIntro>
          <Stagger as="ul" item="li" itemClassName="flex gap-3 text-ink-muted" className="mt-10 space-y-3 text-sm">
            {["Skipping never trades — your holdings stay exactly as they are.", "If you participate later, the plan starts from what you actually hold now.", "Skipped versions are never replayed one by one."].map((t) => (
              <span key={t} className="contents"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />{t}</span>
            ))}
          </Stagger>
        </div>
        <Reveal className="lg:col-span-6 lg:col-start-7">
          <div className="rounded-shell border border-line bg-surface p-6 shadow-float sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="type-eyebrow text-ink-faint">Example · Core Crypto Index</p>
                <p className="mt-2 text-xl font-normal tracking-tight text-ink">Version 3 is available</p>
              </div>
              <span className="rounded-pill bg-accent-soft px-3 py-1 font-mono text-xs text-accent">v2 → v3</span>
            </div>
            <blockquote className="mt-5 border-l-2 border-line-strong pl-4 text-sm text-ink-muted">
              “Bitcoin’s capped market value rose relative to Ether at the quarterly review.” — Lead manager
            </blockquote>
            <WeightDiff className="mt-6" rows={[
              { key: "btc", label: "BTC", fromBps: 3000, toBps: 3500 }, { key: "eth", label: "ETH", fromBps: 3500, toBps: 3000 },
              { key: "sol", label: "SOL", fromBps: 2000, toBps: 2000 }, { key: "link", label: "LINK", fromBps: 800, toBps: 800 }, { key: "bnb", label: "BNB", fromBps: 700, toBps: 700 },
            ]} />
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <span className={cn(buttonVariants(), "pointer-events-none")}>Review &amp; participate</span>
              <span className={cn(buttonVariants({ variant: "secondary" }), "pointer-events-none")}>Skip this version</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const CHAINS = ["solana", "ethereum", "base", "bnb", "arbitrum", "bitcoin"];

/** Multi-chain, made calm. */
export function MultiChain() {
  return (
    <section aria-labelledby="chains-title" className="border-t border-line bg-surface py-28 md:py-40">
      <div className={cn(wrap, "grid items-center gap-16 lg:grid-cols-12")}>
        <Parallax speed={40} className="order-last lg:order-first lg:col-span-5">
          <GlassObject name="glass-network-nodes" className="mx-auto w-full max-w-md" />
        </Parallax>
        <div className="lg:col-span-6 lg:col-start-7">
          <SectionIntro id="chains-title" eyebrow="Multi-chain, without the maze" title="One investment. Several networks. One view.">
            You think in baskets; Bytesac maps each asset to its approved network and route, and shows you which wallet signs what — only when it matters.
          </SectionIntro>
          <Stagger className="mt-10 flex flex-wrap gap-2">
            {CHAINS.map((c) => <ChainBadge key={c} chain={c} className="py-1 pr-3 text-sm" />)}
          </Stagger>
          <Reveal className="mt-6 max-w-lg text-sm text-ink-faint">
            Investments are funded in USDC on Solana. Bitcoin is linked as a receiving address on the web. The asset registry decides which assets, networks and routes are supported — an adapter existing is not enough.
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** The manager side, briefly, with the organization model stated plainly. */
export function ForManagers() {
  return (
    <section aria-labelledby="managers-title" className="py-28 md:py-40">
      <div className={cn(wrap, "grid items-center gap-16 lg:grid-cols-12")}>
        <div className="lg:col-span-6">
          <SectionIntro id="managers-title" eyebrow="For strategy managers" title="Build strategies as an organization.">
            Verified organizations own their baskets. Teams draft, submit for platform review, publish versions and explain every change — with roles from Owner to Viewer.
          </SectionIntro>
          <Reveal delay={0.15} className="mt-10 flex flex-wrap gap-2">
            <Link href="/for-managers" className={buttonVariants({ variant: "secondary" })}>For organizations<ArrowRight /></Link>
            <Link href="/managers/apply" className={buttonVariants({ variant: "ghost" })}>Apply</Link>
          </Reveal>
        </div>
        <div className="lg:col-span-5 lg:col-start-8">
          <Stagger as="ol" item="li" className="space-y-2">
            {[["Organization", "The verified, durable owner"], ["Basket", "A strategy with assigned managers"], ["Version", "Immutable once published"], ["Your portfolio", "Changes only with your signature"]].map(([t, d], i) => (
              <div key={t} className="flex items-center gap-4 rounded-tile border border-line bg-surface px-5 py-4" style={{ marginLeft: `${i * 1.25}rem` }}>
                <span className="font-mono text-[0.6875rem] text-ink-faint">0{i + 1}</span>
                <span className="flex-1"><span className="block text-ink">{t}</span><span className="block text-sm text-ink-muted">{d}</span></span>
              </div>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

/**
 * Closing bookend mirroring the hero, as in the reference: while it slides up over the page the sky fades in behind
 * the headline, the lines resolve from blur one by one, and the hand-held phone rises into frame.
 */
export function ClosingCta() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const skyOpacity = useTransform(scrollYProgress, [0, 0.55], [0, 1]);
  const phoneY = useTransform(scrollYProgress, [0.2, 1], ["45%", "0%"]);
  return (
    <section ref={ref} aria-labelledby="closing-title" className="relative isolate overflow-hidden pt-28 md:pt-40">
      <motion.div className="absolute inset-0 -z-10" style={reduce ? undefined : { opacity: skyOpacity }}>
        <Sky fade={false} bank="high" />
      </motion.div>
      <div className={cn(wrap, "text-center")}>
        <LineReveal id="closing-title" as="h2" inView className="type-display text-ink" lines={["Your strategy.", <span key="b" className="text-ink-muted">Your wallet. Your call.</span>]} />
        <Reveal delay={0.2} className="mt-10 flex flex-wrap justify-center gap-2">
          <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Explore baskets<ArrowRight /></Link>
          <Link href="/sign-in" className={buttonVariants({ variant: "glass", size: "lg" })}>Sign in with your wallet</Link>
        </Reveal>
      </div>
      <motion.div className="mx-auto mt-16 w-[min(86vw,500px)] translate-x-[-8%]" style={reduce ? undefined : { y: phoneY }}>
        <HandPhone screen={<ExampleBasketScreen />} />
      </motion.div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-canvas" />
    </section>
  );
}
