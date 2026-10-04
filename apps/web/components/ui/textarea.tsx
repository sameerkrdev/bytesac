import * as React from "react";
import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClass, "min-h-28 py-2.5 leading-relaxed", className)} {...props} />;
}

export { Textarea };
