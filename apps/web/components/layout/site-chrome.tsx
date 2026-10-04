"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ArrowUpRight, Menu as MenuIcon, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { isCurrent, PUBLIC_NAV } from "@/components/layout/nav";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Floating marketing header: transparent over the hero, a glass pill once the page scrolls. */
export function SiteHeader() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5">
      <div className={cn("mx-auto flex h-14 max-w-7xl items-center gap-4 rounded-pill pr-2 pl-4 transition-[background-color,box-shadow,border-color] duration-500 ease-calm sm:pl-5", scrolled ? "glass shadow-soft" : "border border-transparent")}>
        <Link href="/" aria-label="Bytesac home" className="flex min-h-11 items-center"><Logo size={24} /></Link>
        <nav aria-label="Primary" className="hidden flex-1 justify-center lg:flex">
          <ul className="flex items-center gap-1">
            {PUBLIC_NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} aria-current={isCurrent(path, n.href) ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-pill px-3.5 text-sm text-ink-muted transition-colors hover:text-ink", isCurrent(path, n.href) && "text-ink")}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>Sign in</Link>
          <Link href="/baskets" className={cn(buttonVariants(), "hidden sm:inline-flex")}>Explore baskets</Link>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger aria-label="Open menu" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "lg:hidden")}><MenuIcon /></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-50 bg-overlay transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
              <Dialog.Popup className="atmosphere fixed inset-x-3 top-3 z-50 rounded-shell border border-line p-5 shadow-float transition-[transform,opacity] duration-300 ease-calm data-[ending-style]:-translate-y-3 data-[ending-style]:opacity-0 data-[starting-style]:-translate-y-3 data-[starting-style]:opacity-0">
                <div className="flex items-center justify-between">
                  <Logo size={24} />
                  <Dialog.Close aria-label="Close menu" className={buttonVariants({ variant: "ghost", size: "icon" })}><X /></Dialog.Close>
                </div>
                <Dialog.Title className="sr-only">Menu</Dialog.Title>
                <nav aria-label="Menu" className="mt-6">
                  <ul className="divide-y divide-line/70">
                    {PUBLIC_NAV.map((n) => (
                      <li key={n.href}><Link href={n.href} className="flex min-h-14 items-center justify-between text-2xl font-light tracking-tight text-ink">{n.label}<ArrowUpRight aria-hidden className="size-5 text-ink-faint" /></Link></li>
                    ))}
                  </ul>
                </nav>
                <div className="mt-8 grid gap-2">
                  <Link href="/baskets" className={buttonVariants({ size: "lg" })}>Explore baskets</Link>
                  <Link href="/sign-in" className={buttonVariants({ variant: "secondary", size: "lg" })}>Sign in with your wallet</Link>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}

const FOOTER: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "Invest", links: [{ href: "/baskets", label: "Discover baskets" }, { href: "/how-it-works", label: "How it works" }, { href: "/self-custody", label: "Your wallet, your signature" }, { href: "/fees", label: "Fees" }] },
  { title: "Managers", links: [{ href: "/for-managers", label: "For organizations" }, { href: "/managers/apply", label: "Apply" }, { href: "/managers/status", label: "Application status" }] },
  { title: "Account", links: [{ href: "/sign-in", label: "Sign in" }, { href: "/portfolio", label: "Portfolio" }, { href: "/profile", label: "Profile" }] },
];

/** Footer with an oversized cropped wordmark as the sign-off. */
export function SiteFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 pt-16 pb-10 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-10">
        <div className="max-w-sm space-y-4">
          <Logo size={26} />
          <p className="text-sm text-ink-muted">Strategy baskets from verified organizations. You invest from your own wallet, sign every transaction, and decide whether to follow each strategy update.</p>
          <ThemeSwitch />
        </div>
        {FOOTER.map((c) => (
          <nav key={c.title} aria-label={c.title} className="space-y-3">
            <p className="type-eyebrow text-ink-faint">{c.title}</p>
            <ul className="space-y-1">
              {c.links.map((l) => <li key={l.href}><Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-ink-muted transition-colors hover:text-ink">{l.label}</Link></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <p className="border-t border-line py-6 text-xs leading-relaxed text-ink-faint">
          Bytesac is software for researching and executing strategy baskets from your own wallet. Digital assets are volatile and you can lose money. Basket performance shown on this site is simulated model performance, not actual investor results. Nothing here is investment advice. <span className="whitespace-nowrap">[Placeholder legal copy — pending review.]</span>
        </p>
      </div>
      <div aria-hidden className="pointer-events-none mx-auto -mb-[0.22em] max-w-7xl overflow-hidden px-2 text-center text-[clamp(5rem,22vw,20rem)] leading-[0.8] font-light tracking-[-0.06em] text-transparent select-none [-webkit-text-stroke:1px_var(--c-line-strong)]">
        bytesac
      </div>
    </footer>
  );
}
