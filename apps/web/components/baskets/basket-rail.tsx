"use client";

import type { DiscoverySearchItem } from "@repo/validator";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BasketCard } from "@/components/baskets/basket-card";
import { cn } from "@/lib/utils";

/**
 * A titled, horizontally scrolling row of basket cards (Featured, Trending, Suggested). Snaps per card; arrow buttons
 * page it on pointer devices. Renders nothing when there are no items.
 */
export function BasketRail({ id, title, description, icon, items, href, bleed = false }: {
  id: string; title: string; description?: ReactNode; icon?: ReactNode; items: DiscoverySearchItem[]; href?: string; bleed?: boolean;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    on();
    el.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { el.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [items.length]);
  if (items.length === 0) return null;
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  const arrow = "grid size-10 place-items-center rounded-full border border-line bg-surface text-ink transition-[opacity,border-color] hover:border-line-strong disabled:opacity-35";
  return (
    <section aria-labelledby={id} className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id={id} className="flex items-center gap-2 type-heading text-ink">{icon}{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {href && <Link href={href} className="inline-flex min-h-10 items-center gap-1 px-2 text-sm text-ink-muted hover:text-ink">See all<ArrowRight aria-hidden className="size-3.5" /></Link>}
          <div className="hidden gap-2 md:flex">
            <button type="button" className={arrow} disabled={edges.start} onClick={() => page(-1)} aria-label={`Previous ${title}`}><ChevronLeft aria-hidden className="size-4" /></button>
            <button type="button" className={arrow} disabled={edges.end} onClick={() => page(1)} aria-label={`More ${title}`}><ChevronRight aria-hidden className="size-4" /></button>
          </div>
        </div>
      </div>
      <ul ref={scroller} className={cn("flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", bleed && "-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [scroll-padding-inline:1rem] sm:[scroll-padding-inline:1.5rem] lg:[scroll-padding-inline:2.5rem]")}>
        {items.map((b) => <li key={b.slug} className="w-[min(82vw,20rem)] shrink-0 snap-start"><BasketCard b={b} /></li>)}
      </ul>
    </section>
  );
}
