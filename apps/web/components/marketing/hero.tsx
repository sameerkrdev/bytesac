"use client";

import { ArrowRight, Check, GitCompareArrows, Wallet } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { useJoinHref, useMarketing } from "@/components/layout/surface";
import { DUR, EASE, LineReveal } from "@/components/motion/reveal";
import { buttonVariants } from "@/components/ui/button";
import { ExampleBasketScreen } from "@/components/visual/phone-screens";
import { HandPhone, Sky } from "@/components/visual/scenery";
import { cn } from "@/lib/utils";

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
  const marketing = useMarketing();
  const joinHref = useJoinHref();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const skyY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  return (
    <section ref={ref} aria-labelledby="hero-title" className="relative isolate min-h-svh overflow-hidden lg:min-h-[max(100svh,860px)]">
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
            {marketing
              ? <a href={joinHref} className={buttonVariants({ size: "lg" })}>Join the waitlist<ArrowRight /></a>
              : <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Explore baskets<ArrowRight /></Link>}
            <Link href="/how-it-works" className={buttonVariants({ variant: "glass", size: "lg" })}>How it works</Link>
          </div>
        </motion.div>
      </div>

      <div className="relative mx-auto mt-6 h-[min(140vw,700px)] max-w-7xl px-4 sm:h-[700px] lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:h-[760px]">
        <motion.div className="absolute bottom-0 left-1/2 w-[min(96vw,480px)] -translate-x-[58%] lg:left-auto lg:right-[1%] lg:w-[520px] lg:translate-x-0 xl:-right-[3%]" style={reduce ? undefined : { y: phoneY }}>
          <motion.div initial={reduce ? false : { y: 220, opacity: 0, filter: "blur(12px)" }} animate={{ y: 0, opacity: 1, filter: "blur(0px)" }} transition={{ duration: DUR.hero, ease: EASE, delay: 0.75 }}>
            <HandPhone priority screen={<ExampleBasketScreen />} />
          </motion.div>
        </motion.div>

        <Chip progress={scrollYProgress} depth={160} delay={1.85} className="top-0 right-3 hidden w-56 md:block sm:top-[30%] sm:right-4 sm:w-60 md:right-[6%] lg:right-[0.5%] lg:top-[56%] xl:right-[2%]">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-ink"><Wallet className="size-4" /></span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink">You sign every step</p>
              <p className="text-xs text-ink-muted">Each transaction is approved in your own wallet, against the plan you reviewed.</p>
            </div>
          </div>
        </Chip>

        <Chip progress={scrollYProgress} depth={60} delay={2.05} className="bottom-[10%] left-4 hidden w-72 md:block md:left-[8%] lg:left-auto lg:right-[calc(1%+300px)] lg:bottom-[9%] xl:right-[calc(-3%+300px)]">
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
