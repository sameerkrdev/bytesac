import type { CSSProperties, ReactNode } from "react";
import { Mark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type CloudName = "bank" | "wisps";

/**
 * One endlessly drifting cloud strip. The transparent image is laid out as [A, mirror(A)] × 3 and slid by one pair, so
 * the loop never shows a seam. `seconds` is the time to cross one pair: long, so the sky barely seems to move.
 */
function CloudStrip({ name, seconds, className, style, priority = false, reverse = false }: { name: CloudName; seconds: number; className?: string; style?: CSSProperties; priority?: boolean; reverse?: boolean }) {
  const src = `/visuals/atmosphere/clouds-${name}-1600.webp`;
  const srcSet = `/visuals/atmosphere/clouds-${name}-1600.webp 1600w, /visuals/atmosphere/clouds-${name}-2560.webp 2560w`;
  return (
    <div className={cn("absolute inset-x-0 overflow-hidden", className)} style={style}>
      <div className="flex h-full w-max will-change-transform"
        style={{ animation: `bx-drift ${seconds}s linear infinite${reverse ? " reverse" : ""}`, ["--drift-to" as string]: "-33.3333%" }}>
        {Array.from({ length: 6 }, (_, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- decorative transparent strip; next/image adds nothing here
          <img key={i} alt="" aria-hidden src={src} srcSet={srcSet} sizes="(min-width: 1024px) 2560px, 1600px" draggable={false}
            fetchPriority={priority && i === 0 ? "high" : "auto"} loading={priority || i < 2 ? "eager" : "lazy"} decoding="async"
            className={cn("h-full w-auto max-w-none select-none [filter:var(--c-cloud-filter)]", i % 2 === 1 && "-scale-x-100")} />
        ))}
      </div>
    </div>
  );
}

/**
 * The sky behind bookend sections, after the primary reference: a clear blue gradient with soft cumulus banks that
 * drift slowly sideways (high wisps slower than the low bank, so it reads as depth). Night in the dark theme.
 * Decorative. `fade` blends the bottom edge into the page canvas; `bank` sets how high the low clouds reach.
 */
export function Sky({ className, fade = true, priority = false, bank = "low" }: { className?: string; fade?: boolean; priority?: boolean; bank?: "low" | "high" | "none" }) {
  return (
    <div aria-hidden className={cn("sky-field pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <CloudStrip name="wisps" seconds={420} priority={priority} className="top-[8%] h-[34%]" style={{ opacity: "calc(var(--c-cloud-opacity) * 0.7)" }} />
      {bank !== "none" && (
        <>
          <CloudStrip name="bank" seconds={300} reverse priority={priority}
            className={cn("bottom-[6%] blur-[1px]", bank === "high" ? "h-[52%]" : "h-[34%]")} style={{ opacity: "calc(var(--c-cloud-opacity) * 0.75)" }} />
          <CloudStrip name="bank" seconds={190} priority={priority}
            className={cn("-bottom-[4%]", bank === "high" ? "h-[46%]" : "h-[30%]")} style={{ opacity: "var(--c-cloud-opacity)" }} />
        </>
      )}
      {fade && <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-b from-transparent to-canvas" />}
    </div>
  );
}

/* Screen rectangles of the transparent device images, as % of the image (see public/visuals/MANIFEST.md). The screen
 * area of each image is punched out, so real UI sits *behind* the frame and the bezel and Dynamic Island overlap it. */
const PHONE_SCREEN = { left: "4.6%", top: "1.5%", width: "90.8%", height: "97%" };
const HAND_SCREEN = { left: "36%", top: "1.4%", width: "51.9%", height: "78.6%" };

function Screen({ rect, children }: { rect: CSSProperties; children?: ReactNode }) {
  return (
    <div data-theme="light" className="absolute overflow-hidden rounded-[13%/6%] bg-[#F7F8FA] text-[#0F1E3A] [container-type:inline-size]" style={rect}>
      {children ?? (
        <div className="grid h-full place-items-center">
          <Mark size={28} mono className="opacity-25" />
        </div>
      )}
    </div>
  );
}

/**
 * A modern front-facing phone (titanium frame, Dynamic Island). The screen is empty until the real Expo screens exist
 * (brief phase 15); `screen` places real UI into it — size that UI in `cqw` so it scales with the device.
 */
export function Phone({ className, screen, priority = false, sizes = "(min-width: 1024px) 360px, 60vw" }: { className?: string; screen?: ReactNode; priority?: boolean; sizes?: string }) {
  return (
    <div className={cn("relative aspect-[892/1860]", className)}>
      <Screen rect={PHONE_SCREEN}>{screen}</Screen>
      {/* eslint-disable-next-line @next/next/no-img-element -- transparent device frame with a measured screen slot */}
      <img alt="" aria-hidden src="/visuals/devices/iphone-front-900.webp" srcSet="/visuals/devices/iphone-front-480.webp 480w, /visuals/devices/iphone-front-900.webp 900w"
        sizes={sizes} fetchPriority={priority ? "high" : "auto"} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
    </div>
  );
}

/** A hand holding the same phone, for bookends (hero, closing CTA). Same screen contract as `Phone`. */
export function HandPhone({ className, screen, priority = false }: { className?: string; screen?: ReactNode; priority?: boolean }) {
  return (
    <div className={cn("relative aspect-[1353/1915]", className)}>
      <Screen rect={HAND_SCREEN}>{screen}</Screen>
      {/* eslint-disable-next-line @next/next/no-img-element -- transparent device frame with a measured screen slot */}
      <img alt="" aria-hidden src="/visuals/devices/hand-iphone-1000.webp" srcSet="/visuals/devices/hand-iphone-560.webp 560w, /visuals/devices/hand-iphone-1000.webp 1000w"
        sizes="(min-width: 1024px) 560px, 80vw" fetchPriority={priority ? "high" : "auto"} draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none dark:brightness-[0.86]" />
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
