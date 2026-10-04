"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

/** 44px hit area around a 24px track. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill border border-transparent p-0.5 transition-colors duration-200 outline-none after:absolute after:-inset-2.5 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas data-checked:bg-primary data-unchecked:bg-line-strong data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block size-5 rounded-full bg-surface shadow-soft transition-transform duration-200 ease-calm data-checked:translate-x-4 data-unchecked:translate-x-0 dark:data-checked:bg-primary-ink" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
