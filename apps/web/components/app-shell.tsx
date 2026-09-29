"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [{ href: "/home", label: "Home" }, { href: "/profile", label: "Profile" }];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="min-h-screen bg-space">
      <header className="border-b border-border-dark bg-slate/60">
        <nav aria-label="Primary" className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
          <Link href="/home" className="flex items-center gap-2"><Logo size={28} /><span className="font-display text-lg font-bold text-ivory">Bytesac</span></Link>
          <ul className="flex gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} aria-current={path === n.href ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone hover:text-ivory", path === n.href && "bg-slate text-ivory")}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="ml-auto min-h-11" onClick={async () => { await api.logout().catch(() => undefined); router.replace("/sign-in"); }}>
            Log out
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
