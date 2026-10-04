import type { ReactNode } from "react";
import { LineReveal, Reveal } from "@/components/motion/reveal";
import { GlassObject, Sky } from "@/components/visual/scenery";

/** Hero for supporting marketing pages: sky bookend, eyebrow, two-line title, lede, optional glass object. */
export function PageHero({ eyebrow, lines, lede, object, children }: {
  eyebrow: string; lines: ReactNode[]; lede: ReactNode; object?: "glass-allocation-ring" | "glass-wallet" | "glass-network-nodes" | "glass-portfolio-prism"; children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-hero-title" className="relative isolate overflow-hidden pt-36 pb-24 md:pt-44 md:pb-32">
      <Sky className="-z-10" priority />
      <div className="mx-auto grid max-w-7xl items-end gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-10">
        <div className="lg:col-span-7">
          <Reveal as="p" className="type-eyebrow text-ink-muted">{eyebrow}</Reveal>
          <LineReveal id="page-hero-title" className="mt-6 type-display text-ink" delay={0.15} lines={lines} />
          <Reveal delay={0.5} className="mt-8 max-w-xl type-lede text-ink-muted">{lede}</Reveal>
          {children && <Reveal delay={0.65} className="mt-8 flex flex-wrap gap-2">{children}</Reveal>}
        </div>
        {object && (
          <Reveal delay={0.4} className="lg:col-span-4 lg:col-start-9">
            <GlassObject name={object} className="mx-auto w-[min(70vw,360px)] mix-blend-normal" sizes="360px" />
          </Reveal>
        )}
      </div>
    </section>
  );
}

/** Numbered text block used down the long-form pages. */
export function Chapter({ n, title, children, aside }: { n: string; title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <Reveal as="article" className="grid gap-6 border-t border-line py-14 md:grid-cols-12 md:py-20">
      <p className="font-mono text-xs text-ink-faint md:col-span-2">{n}</p>
      <div className="space-y-4 md:col-span-6">
        <h2 className="type-title text-ink">{title}</h2>
        <div className="space-y-4 text-ink-muted [&_strong]:font-medium [&_strong]:text-ink">{children}</div>
      </div>
      {aside && <div className="md:col-span-4">{aside}</div>}
    </Reveal>
  );
}
