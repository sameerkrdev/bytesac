import type { ReactNode } from "react";
import { Mark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * The sky plate behind bookend sections: day sky in the light theme, high-altitude dusk in the dark theme.
 * Decorative (empty alt). `fade` blends the bottom edge into the page canvas.
 */
export function Sky({ className, fade = true, priority = false }: { className?: string; fade?: boolean; priority?: boolean }) {
  const img = (name: "day" | "night", cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- static responsive art; next/image adds nothing for a decorative plate
    <img alt="" aria-hidden src={`/visuals/atmosphere/sky-${name}-1440.webp`}
      srcSet={`/visuals/atmosphere/sky-${name}-800.webp 800w, /visuals/atmosphere/sky-${name}-1440.webp 1440w, /visuals/atmosphere/sky-${name}-2560.webp 2560w`}
      sizes="100vw" fetchPriority={priority ? "high" : "auto"} decoding="async" className={cn("absolute inset-0 h-full w-full object-cover object-bottom", cls)} />
  );
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {img("day", "dark:hidden")}
      {img("night", "hidden dark:block")}
      {fade && <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-canvas" />}
    </div>
  );
}

/** Screen rectangle of hand-phone-empty-*.webp as % of the image (see public/visuals/MANIFEST.md). */
const SCREEN = { left: "34.4%", top: "21.6%", width: "31.0%", height: "51.2%" };

/**
 * A hand holding a phone whose screen is intentionally empty until the real Expo screens exist (brief phase 15).
 * `screen` can place real UI into the screen rectangle; by default it shows a quiet Bytesac boot state.
 */
export function HandPhone({ className, screen, priority = false }: { className?: string; screen?: ReactNode; priority?: boolean }) {
  return (
    <div className={cn("relative aspect-[880/1168]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- transparent cut-out with a measured screen slot */}
      <img alt="" aria-hidden src="/visuals/devices/hand-phone-empty-880.webp" srcSet="/visuals/devices/hand-phone-empty-520.webp 520w, /visuals/devices/hand-phone-empty-880.webp 880w"
        sizes="(min-width: 1024px) 440px, 60vw" fetchPriority={priority ? "high" : "auto"} className="absolute inset-0 h-full w-full select-none dark:brightness-[0.82] dark:contrast-[1.05]" />
      <div className="absolute overflow-hidden rounded-[13%/6%] bg-[#F7F8FA]" style={SCREEN}>
        {screen ?? (
          <div className="grid h-full place-items-center">
            <Mark size={28} className="text-[#1C2B4A] opacity-25" />
          </div>
        )}
      </div>
    </div>
  );
}

/** A transparent glass object from public/visuals/objects. */
export function GlassObject({ name, className, alt = "", sizes = "(min-width: 1024px) 480px, 70vw" }: { name: "glass-allocation-ring" | "glass-wallet" | "glass-network-nodes" | "glass-portfolio-prism"; className?: string; alt?: string; sizes?: string }) {
  const [small, large] = name === "glass-portfolio-prism" ? [560, 1000] : [640, 1200];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- transparent art with a manual srcset
    <img alt={alt} aria-hidden={alt === "" ? true : undefined} src={`/visuals/objects/${name}-${large}.webp`} srcSet={`/visuals/objects/${name}-${small}.webp ${small}w, /visuals/objects/${name}-${large}.webp ${large}w`}
      sizes={sizes} loading="lazy" decoding="async" className={cn("pointer-events-none select-none mix-blend-multiply dark:mix-blend-normal", className)} />
  );
}
