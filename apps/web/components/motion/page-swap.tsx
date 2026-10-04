"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing page's core scroll move, from the primary reference (docs/design/MOTION-STUDY.md, 15 fps study): a
 * chapter pins once its bottom reaches the bottom of the viewport, and the next chapter slides up over it from below
 * like a page being swapped in, while the covered chapter eases back (rises slightly, shrinks, dims).
 *
 * Put every `SwapPanel` directly inside one `SwapStack`. Panels taller than the viewport are read normally first and
 * pin only at their end, so nothing is ever cut off. Under reduced motion panels simply scroll.
 */
export function SwapStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative isolate", className)}>{children}</div>;
}

export function SwapPanel({ children, className, first = false, last = false, tone }: {
  children: ReactNode; className?: string; first?: boolean; last?: boolean; tone?: "dark";
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const pin = !reduce && !last;

  // Pin at the bottom edge: top = viewport height − panel height (≤ 0 for tall panels).
  useEffect(() => {
    const el = ref.current;
    if (!el || !pin) return;
    const set = () => { el.style.top = `${Math.min(0, window.innerHeight - el.offsetHeight)}px`; };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    return () => { ro.disconnect(); window.removeEventListener("resize", set); };
  }, [pin]);

  // 0 when the panel's end meets the viewport's end, 1 once the next panel has fully covered it.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["end end", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "-4%"]);
  const dim = useTransform(scrollYProgress, [0, 1], [0, 0.4]);

  return (
    <div
      ref={ref}
      data-theme={tone}
      className={cn(
        "relative overflow-clip bg-canvas text-ink",
        pin && "sticky",
        !first && "-mt-px rounded-t-[2rem] shadow-[0_-24px_60px_-12px_rgba(15,30,58,0.18)] md:rounded-t-[3rem] dark:shadow-[0_-24px_60px_-12px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      {pin ? (
        <motion.div style={{ scale, y }} className="origin-[50%_100%]">{children}</motion.div>
      ) : children}
      {pin && <motion.div aria-hidden style={{ opacity: dim }} className="pointer-events-none absolute inset-0 z-50 bg-[#0B1424]" />}
    </div>
  );
}
