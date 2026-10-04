import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Pills throughout. `default` is the single primary action (navy in light, ivory in dark); `secondary` is a quiet
 * surface pill; `glass` sits over atmosphere; `ghost` is for toolbars; `destructive` is soft, never a red slab.
 * Every size meets the 44px touch target except `sm`, which is for dense desktop tables only.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-pill border border-transparent text-sm font-medium whitespace-nowrap select-none outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-calm focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-ink shadow-soft hover:bg-primary-hover",
        secondary: "border-line-strong/80 bg-surface text-ink hover:border-ink-faint hover:bg-surface-muted",
        outline: "border-line-strong bg-transparent text-ink hover:bg-surface-muted",
        glass: "glass text-ink hover:bg-surface",
        ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink aria-expanded:bg-surface-muted aria-expanded:text-ink",
        destructive: "border-danger/25 bg-danger-soft text-danger hover:border-danger/50",
        link: "h-auto! rounded-sm px-0! text-ink underline underline-offset-4-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5",
        sm: "min-h-9 px-3.5 text-[0.8125rem]",
        lg: "min-h-12 px-7 text-[0.9375rem]",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({ className, variant = "default", size = "default", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
