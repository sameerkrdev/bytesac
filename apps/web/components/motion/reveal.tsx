"use client";

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Children, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Motion tokens (docs/design/MOTION-STUDY.md): long calm settle, no overshoot. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DUR = { fast: 0.16, base: 0.32, slow: 0.7, hero: 1.1 } as const;

type Tag = "div" | "section" | "li" | "ul" | "p" | "span" | "figure" | "article";

/**
 * Fades and rises into place, sharpening from a slight blur, the first time it scrolls into view.
 * With reduced motion it renders in its final state.
 */
export function Reveal({ children, className, delay = 0, y = 16, blur = true, as = "div", once = true, amount = 0.3 }: {
  children: ReactNode; className?: string; delay?: number; y?: number; blur?: boolean; as?: Tag; once?: boolean; amount?: number;
}) {
  const reduce = useReducedMotion();
  const M = motion[as];
  if (reduce) return <M className={className}>{children}</M>;
  return (
    <M
      className={className}
      initial={{ opacity: 0, y, filter: blur ? "blur(8px)" : "blur(0px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once, amount }}
      transition={{ duration: DUR.slow, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/**
 * Children reveal one after another (80 ms apart) as the group enters the viewport. Each child is wrapped in an
 * `item` element (use `as="ul" item="li"` for lists, so the markup stays a real list).
 */
export function Stagger({ children, className, as = "div", item = "div", itemClassName, step = 0.08, delay = 0, y = 16 }: {
  children: ReactNode; className?: string; as?: Tag | "ol"; item?: "div" | "li"; itemClassName?: string; step?: number; delay?: number; y?: number;
}) {
  const reduce = useReducedMotion();
  const M = motion[as];
  const I = motion[item];
  return (
    <M className={className} initial={reduce ? false : "hidden"} whileInView="shown" viewport={{ once: true, amount: 0.2 }} transition={{ staggerChildren: step, delayChildren: delay }}>
      {Children.map(children, (c) => (
        <I className={itemClassName} variants={{ hidden: { opacity: 0, y, filter: "blur(6px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: DUR.slow, ease: EASE } } }}>{c}</I>
      ))}
    </M>
  );
}

/**
 * A headline whose lines rise from behind a mask one after another (120 ms apart). Pass each line as a child so the
 * break points are deliberate; screen readers get the full sentence once.
 */
export function LineReveal({ lines, className, lineClassName, delay = 0, as: Heading = "h1", inView = false, id }: {
  lines: ReactNode[]; className?: string; lineClassName?: string; delay?: number; as?: "h1" | "h2" | "p"; inView?: boolean; id?: string;
}) {
  const reduce = useReducedMotion();
  const M = motion[Heading];
  // The heading itself is observed (the masked lines start outside their clip box, so they can't be).
  const trigger = inView ? { whileInView: "shown", viewport: { once: true, amount: 0.4 } } : { animate: "shown" };
  return (
    <M id={id} className={className} initial={reduce ? false : "hidden"} {...trigger}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className={cn("block will-change-transform", lineClassName)}
            variants={{ hidden: { y: "105%" }, shown: { y: "0%", transition: { duration: DUR.slow + 0.2, ease: EASE, delay: delay + i * 0.12 } } }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </M>
  );
}

/** Scroll progress of an element through the viewport (0 entering → 1 leaving), for parallax and pinned scenes. */
export function useSectionProgress(offset: ["start end", "end start"] | ["start start", "end end"] | ["start end", "end end"] = ["start end", "end start"]) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  return { ref, progress: scrollYProgress };
}

/** Moves its children vertically at a different rate from the page (`speed` px of travel across the viewport). */
export function Parallax({ children, className, speed = 60 }: { children: ReactNode; className?: string; speed?: number }) {
  const reduce = useReducedMotion();
  const { ref, progress } = useSectionProgress();
  const y = useTransform(progress, [0, 1], [speed, -speed]);
  return (
    <div ref={ref} className={className}>
      <motion.div style={reduce ? undefined : { y }}>{children}</motion.div>
    </div>
  );
}

export type { MotionValue };
