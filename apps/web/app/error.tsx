"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/** Last-resort boundary for a page that failed to render (for example the API was unreachable). */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" /></span>
      <h1 className="type-heading text-ink">We couldn&apos;t load this page</h1>
      <p className="text-ink-muted">Bytesac didn&apos;t respond in time. Nothing in your wallet changed. Try again in a moment.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>Go home</Link>
      </div>
    </div>
  );
}
