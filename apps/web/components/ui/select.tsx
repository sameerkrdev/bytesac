import * as React from "react"
import { cn } from "@/lib/utils"

/** Native select: keyboard, mobile pickers and a11y for free. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "min-h-11 w-full rounded-lg border border-input bg-space px-2.5 text-base text-ivory transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Select }
