"use client";

import { ArrowRight, Check, GitCompareArrows, Wallet } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { DUR, EASE, LineReveal } from "@/components/motion/reveal";
import { buttonVariants } from "@/components/ui/button";
import { AllocationRing } from "@/components/visual/allocation-ring";
import { HandPhone, Sky } from "@/components/visual/scenery";
import { cn } from "@/lib/utils";

const EXAMPLE = [
  { key: "btc", label: "BTC", bps: 3500 }, { key: "eth", label: "ETH", bps: 3000 }, { key: "sol", label: "SOL", bps: 2000 }, { key: "rwa", label: "Tokenized T-bills", bps: 1500 },
];

/** A floating glass chip that settles in after the device (blur → sharp), at its own parallax depth. */
function Chip({ children, className, delay, depth, progress }: { children: React.ReactNode; className?: string; delay: number; depth: number; progress: ReturnType<typeof useScroll>["scrollYProgress"] }) {
  const reduce = useReducedMotion();
  const y = useTransform(progress, [0, 1], [0, -depth]);
  return (
    <motion.div style={reduce ? undefined : { y }} className={cn("absolute z-10", className)}>
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.96, filter: "blur(10px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: DUR.slow, ease: EASE, delay }}
        className="glass rounded-card p-4 shadow-float"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * Load choreography from the motion study: atmosphere → headline lines → device rises → data chips settle → actions.
 * Chips are illustrative and say so; nothing here is a screenshot of the app.
 */
export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const skyY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  return (
    <section ref={ref} aria-labelledby="hero-title" className="relative isolate overflow-hidden lg:min-h-[max(100svh,860px)]">
      <motion.div className="absolute inset-0 -z-10" style={reduce ? undefined : { y: skyY }} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EASE }}>
        <Sky priority />
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-4 pt-32 sm:px-6 md:pt-40 lg:px-10">
        <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.slow, delay: 0.2 }} className="type-eyebrow mb-6 text-ink-muted">
          Strategy baskets · Your own wallet
        </motion.p>
        <LineReveal id="hero-title" className="type-hero relative z-20 max-w-[16ch] text-ink lg:max-w-none" delay={0.3} lines={["Invest in strategies,", <span key="2" className="text-ink-muted">not individual trades.</span>]} />
        <motion.div className="relative z-20 mt-10 flex max-w-md flex-col gap-6" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.slow, ease: EASE, delay: 1.5 }}>
          <p className="type-lede text-ink-muted">
            Discover curated baskets from verified organizations, research every decision behind them, and invest from your own wallet — approving each step yourself.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Explore baskets<ArrowRight /></Link>
            <Link href="/how-it-works" className={buttonVariants({ variant: "glass", size: "lg" })}>How it works</Link>
          </div>
        </motion.div>
      </div>

      <div className="relative mx-auto mt-6 h-[min(118vw,600px)] max-w-7xl px-4 sm:h-[640px] lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:h-[760px]">
        <motion.div className="absolute bottom-0 left-1/2 w-[min(78vw,420px)] -translate-x-1/2 lg:left-auto lg:right-[12%] lg:w-[440px] lg:translate-x-0" style={reduce ? undefined : { y: phoneY }}>
          <motion.div initial={reduce ? false : { y: 220, opacity: 0, filter: "blur(12px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} transition={{ duration: DUR.hero, ease: EASE, delay: 0.75 }}>
            <HandPhone priority />
          </motion.div>
        </motion.div>

        <Chip progress={scrollYProgress} depth={90} delay={1.6} className="top-[4%] left-4 hidden w-64 sm:block md:left-[6%] lg:hidden xl:block xl:left-auto xl:right-[calc(12%+380px)] xl:top-[50%]">
          <p className="type-eyebrow text-ink-faint">Example basket · target</p>
          <div className="mt-3 flex items-center gap-4">
            <AllocationRing slices={EXAMPLE} size={72} thickness={9} label="Example target allocation: BTC 35%, ETH 30%, SOL 20%, tokenized T-bills 15%" />
            <ul className="space-y-1 text-xs text-ink-muted">
              {EXAMPLE.map((s) => <li key={s.key} className="flex justify-between gap-3"><span>{s.label}</span><span className="font-mono text-ink">{s.bps / 100}%</span></li>)}
            </ul>
          </div>
        </Chip>

        <Chip progress={scrollYProgress} depth={160} delay={1.85} className="top-0 right-3 w-56 sm:top-[30%] sm:right-4 sm:w-60 md:right-[6%] lg:right-[3%] lg:top-[40%]">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-ink"><Wallet className="size-4" /></span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink">You sign every step</p>
              <p className="text-xs text-ink-muted">Each transaction is approved in your own wallet, against the plan you reviewed.</p>
            </div>
          </div>
        </Chip>

        <Chip progress={scrollYProgress} depth={60} delay={2.05} className="bottom-[10%] left-4 hidden w-72 md:block md:left-[8%] lg:left-auto lg:right-[calc(12%+330px)] lg:bottom-[8%]">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-ink"><GitCompareArrows className="size-4 text-accent" />New version available</span>
            <span className="rounded-pill bg-accent-soft px-2 py-0.5 font-mono text-[0.6875rem] text-accent">v2 → v3</span>
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-pill bg-primary px-3 py-1.5 text-primary-ink"><Check className="size-3" />Review update</span>
            <span className="inline-flex items-center rounded-pill border border-line-strong px-3 py-1.5 text-ink-muted">Skip</span>
          </div>
        </Chip>
      </div>
    </section>
  );
}
