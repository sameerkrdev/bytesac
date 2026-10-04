import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared field look: 44px, hairline, soft focus ring. Used by Input, Select and Textarea. */
export const fieldClass =
  "w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-base text-ink transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/15 md:text-sm";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <InputPrimitive type={type} data-slot="input" className={cn(fieldClass, "h-11 py-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink", className)} {...props} />;
}

export { Input };
