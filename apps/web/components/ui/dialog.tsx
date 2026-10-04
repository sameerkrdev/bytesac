"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay backdrop-blur-[2px] transition-opacity duration-300 ease-calm data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Centred panel on desktop, bottom sheet on phones. Enter/exit use Base UI's starting/ending style hooks so they
 * respect reduced motion through the global transition kill switch.
 */
function DialogContent({ className, children, showCloseButton = true, ...props }: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] w-full gap-5 overflow-y-auto rounded-t-shell border border-line bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-sm text-ink shadow-float outline-none",
          "transition-[transform,opacity] duration-300 ease-calm data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0",
          "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:pb-6 sm:data-[ending-style]:-translate-y-[48%] sm:data-[ending-style]:scale-[0.98] sm:data-[starting-style]:-translate-y-[48%] sm:data-[starting-style]:scale-[0.98]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 pr-8", className)} {...props} />;
}

function DialogFooter({ className, showCloseButton = false, children, ...props }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}>
      {children}
      {showCloseButton && <DialogPrimitive.Close render={<Button variant="secondary" />}>Close</DialogPrimitive.Close>}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-xl font-light tracking-tight text-ink", className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-ink-muted *:[a]:underline *:[a]:underline-offset-3", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
