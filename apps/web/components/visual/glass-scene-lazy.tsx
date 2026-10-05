"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { Slice } from "@/components/visual/allocation-ring";
import type { GlassVariant } from "@/components/visual/glass-scene";
import { GlassObject } from "@/components/visual/scenery";
import { cn } from "@/lib/utils";

const GlassCanvas = dynamic(() => import("@/components/visual/glass-scene"), { ssr: false });

const STILL: Record<GlassVariant, "glass-allocation-ring" | "glass-portfolio-prism"> = { ring: "glass-allocation-ring", stack: "glass-portfolio-prism" };

const DEFAULT_SLICES: Slice[] = [
  { key: "a", label: "A", bps: 3500 }, { key: "b", label: "B", bps: 2500 }, { key: "c", label: "C", bps: 2000 }, { key: "d", label: "D", bps: 1200 }, { key: "e", label: "E", bps: 800 },
];

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * A glass object that assembles in real time (outer frame first, each piece landing on the one before). The ring takes
 * real target weights via `slices`. Shows the generated still instead under reduced motion, without WebGL, or before
 * the 3D chunk loads. `label` names it for assistive tech when it carries meaning; otherwise it is decorative.
 */
export function GlassScene({ variant, slices = DEFAULT_SLICES, className, label }: { variant: GlassVariant; slices?: Slice[]; className?: string; label?: string }) {
  const reduce = useReducedMotion();
  const [three, setThree] = useState(false);
  useEffect(() => { setThree(!reduce && webglAvailable()); }, [reduce]);
  return (
    <div role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("relative", className)}>
      {three
        ? <GlassCanvas variant={variant} slices={slices} className="absolute inset-0" />
        : <GlassObject name={STILL[variant]} className="absolute inset-0 m-auto h-full w-full object-contain" />}
    </div>
  );
}
