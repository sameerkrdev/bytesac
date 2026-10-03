"use client";
import type { MeResponse } from "@repo/validator";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { areaOf, navFor, type NavItem } from "@/components/layout/nav";
import { useMe } from "@/components/me-context";
import { NotificationsBell } from "@/components/notifications/bell";
import { revokePushOnLogout } from "@/components/notifications/push-toggle";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

const link = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone hover:text-ivory";

function NavLinks({ items, path, label, exact }: { items: NavItem[]; path: string; label: string; exact?: boolean }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1">
        {items.map((n) => {
          const current = path === n.href || (!exact && !n.href.includes("#") && path.startsWith(`${n.href}/`));
          return <li key={n.href}><Link href={n.href} aria-current={current ? "page" : undefined} className={cn(link, current && "bg-slate text-ivory")}>{n.label}</Link></li>;
        })}
      </ul>
    </nav>
  );
}

function AccountMenu() {
  const queryClient = useQueryClient();
  const wallet = useWalletConnector();
  return (
    <details className="relative">
      <summary className={cn(link, "cursor-pointer list-none")}>Account</summary>
      <div className="absolute right-0 z-10 mt-1 min-w-40 rounded-xl border border-border-dark bg-slate p-1">
        <Button variant="ghost" className="min-h-11 w-full justify-start" onClick={async () => { await revokePushOnLogout(); await api.logout().catch(() => undefined); queryClient.clear(); await wallet.disconnect().catch(() => undefined); window.location.replace("/sign-in"); }}>
          Log out
        </Button>
      </div>
    </details>
  );
}

/** Header (logo, role-aware navigation, bell, account menu) and the content frame. A second row shows the manager or ops areas while the user is in one. */
export function Shell({ me, children }: { me: MeResponse | null; children: ReactNode }) {
  const path = usePathname();
  const nav = navFor(me);
  const area = areaOf(path);
  const primary = [...nav.primary, ...(nav.manager.length > 0 ? [{ href: "/organization", label: "Manager" }] : []), ...(nav.ops.length > 0 ? [{ href: "/ops", label: "Ops" }] : [])];
  return (
    <div className="min-h-screen bg-space">
      <header className="border-b border-border-dark bg-slate/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:px-8">
          <Link href={me ? "/home" : "/"} className="flex min-h-11 items-center gap-2"><Logo size={28} /><span className="font-display text-lg font-bold text-ivory">Bytesac</span></Link>
          <div className="order-last w-full md:order-none md:w-auto"><NavLinks items={primary} path={path} label="Primary" /></div>
          <div className="ml-auto flex items-center gap-1">
            {me ? <><NotificationsBell /><AccountMenu /></> : <Link href="/sign-in" className={link}>Sign in</Link>}
          </div>
        </div>
        {me && area === "manager" && nav.manager.length > 0 && <div className="mx-auto max-w-6xl border-t border-border-dark px-4 md:px-8"><NavLinks items={nav.manager} path={path} label="Manager" exact /></div>}
        {me && area === "ops" && nav.ops.length > 0 && (
          <div className="mx-auto max-w-6xl space-y-1 border-t border-border-dark px-4 py-1 md:px-8">
            {nav.ops.map((g) => <div key={g.label} className="flex flex-wrap items-center gap-x-2"><span className="w-20 text-xs text-stone">{g.label}</span><NavLinks items={g.items} path={path} label={`Ops ${g.label}`} exact /></div>)}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

/** For signed-in areas: the user comes from the session. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  return <Shell me={me ?? null}>{children}</Shell>;
}

/** For public pages a signed-out visitor sees. */
export function PublicShell({ children }: { children: ReactNode }) {
  return <Shell me={null}>{children}</Shell>;
}
