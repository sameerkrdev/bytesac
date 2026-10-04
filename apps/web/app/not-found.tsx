import Link from "next/link";
import { PublicShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PublicShell bare>
      <section className="atmosphere relative flex min-h-[80dvh] items-center overflow-hidden px-4 pt-24">
        <div className="mx-auto w-full max-w-3xl text-center">
          <p aria-hidden className="type-hero text-[clamp(7rem,28vw,18rem)] text-ink/10">404</p>
          <h1 className="-mt-[0.6em] type-title text-ink">This page isn&apos;t here</h1>
          <p className="mx-auto mt-4 max-w-md text-ink-muted">The link may be old, or the basket may have moved to a new address.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <Link href="/baskets" className={buttonVariants()}>Explore baskets</Link>
            <Link href="/" className={buttonVariants({ variant: "glass" })}>Back to home</Link>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
