"use client";

import { Menu } from "@base-ui/react/menu";
import type { MeResponse } from "@repo/validator";
import { shortAddress } from "@repo/app-core";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Briefcase, ChevronDown, Compass, House, LogOut, Monitor, Moon, PieChart, ShieldCheck, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo, Mark } from "@/components/brand/logo";
import { SiteFooter, SiteHeader } from "@/components/layout/site-chrome";
import { areaOf, isCurrent, navFor, type NavItem } from "@/components/layout/nav";
import { useMe } from "@/components/me-context";
import { NotificationsBell } from "@/components/notifications/bell";
import { revokePushOnLogout } from "@/components/notifications/push-toggle";
import { api } from "@/lib/api";
import { setChoice, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

const TAB_ICONS: Record<string, typeof House> = { "/home": House, "/baskets": Compass, "/portfolio": PieChart, "/notifications": Bell, "/profile": UserRound };

/** True once the page has scrolled, so sticky bars can pick up their glass. */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

function PrimaryNav({ items, path }: { items: NavItem[]; path: string }) {
  return (
    <nav aria-label="Primary" className="hidden md:block">
      <ul className="flex items-center gap-1 rounded-pill border border-line bg-surface/70 p-1">
        {items.map((n) => {
          const current = isCurrent(path, n.href);
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={current ? "page" : undefined}
                className={cn("inline-flex min-h-9 items-center rounded-pill px-4 text-sm text-ink-muted transition-colors hover:text-ink", current && "bg-primary text-primary-ink hover:text-primary-ink")}>
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A horizontally scrollable row of workspace sections (manager, ops). */
function WorkspaceNav({ label, items, path, query }: { label: string; items: NavItem[]; path: string; query?: string }) {
  return (
    <nav aria-label={label} className="-mb-px overflow-x-auto [scrollbar-width:none]">
      <ul className="flex min-w-max items-center gap-1">
        {items.map((n, i) => {
          const current = isCurrent(path, n.href, i === 0);
          return (
            <li key={n.href}>
              <Link href={query ? `${n.href}${query}` : n.href} aria-current={current ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-ink-muted transition-colors hover:text-ink", current && "border-ink text-ink")}>
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const menuItem = "flex min-h-11 w-full cursor-default items-center gap-3 rounded-control px-3 text-sm text-ink outline-none select-none data-[highlighted]:bg-surface-muted";

function AccountMenu({ me, workspaces }: { me: MeResponse; workspaces: NavItem[] }) {
  const queryClient = useQueryClient();
  const wallet = useWalletConnector();
  const theme = useThemeChoice();
  const address = me.wallet.addresses[0]?.address;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="Account" className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-line bg-surface/70 py-1 pr-3 pl-1 text-sm text-ink transition-colors hover:border-line-strong data-[popup-open]:border-line-strong">
        <span aria-hidden className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-sky2 to-sky3 text-ink"><UserRound className="size-4" /></span>
        <span className="hidden font-mono text-xs text-ink-muted sm:inline">{address ? shortAddress(address) : "Account"}</span>
        <ChevronDown aria-hidden className="size-3.5 text-ink-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="w-64 origin-[var(--transform-origin)] rounded-card border border-line bg-surface p-1.5 text-ink shadow-float transition-[transform,opacity] duration-200 ease-calm data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Menu.LinkItem render={<Link href="/profile" />} className={menuItem}><UserRound aria-hidden className="size-4 text-ink-muted" />Profile &amp; wallets</Menu.LinkItem>
            <Menu.LinkItem render={<Link href="/notifications" />} className={menuItem}><Bell aria-hidden className="size-4 text-ink-muted" />Notifications</Menu.LinkItem>
            {workspaces.map((w) => (
              <Menu.LinkItem key={w.href} render={<Link href={w.href} />} className={menuItem}>
                {w.href === "/ops" ? <ShieldCheck aria-hidden className="size-4 text-ink-muted" /> : <Briefcase aria-hidden className="size-4 text-ink-muted" />}{w.label}
              </Menu.LinkItem>
            ))}
            <Menu.Separator className="my-1.5 h-px bg-line" />
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-1 pb-2 type-eyebrow text-ink-faint">Appearance</Menu.GroupLabel>
              <Menu.RadioGroup value={theme} onValueChange={(v) => setChoice(v as ThemeChoice)} className="grid grid-cols-3 gap-1 px-1 pb-1">
                {THEMES.map((t) => (
                  <Menu.RadioItem key={t.value} value={t.value} closeOnClick={false}
                    className="flex min-h-11 cursor-default flex-col items-center justify-center gap-1 rounded-control text-[0.6875rem] text-ink-muted outline-none data-[checked]:bg-surface-muted data-[checked]:text-ink data-[highlighted]:ring-1 data-[highlighted]:ring-line-strong">
                    <t.icon aria-hidden className="size-4" />{t.label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator className="my-1.5 h-px bg-line" />
            <Menu.Item className={menuItem} onClick={async () => { await revokePushOnLogout(); await api.logout().catch(() => undefined); queryClient.clear(); await wallet.disconnect().catch(() => undefined); window.location.replace("/sign-in"); }}>
              <LogOut aria-hidden className="size-4 text-ink-muted" />Log out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Phone tab bar for signed-in investors: the five places they go most. */
function TabBar({ items, path }: { items: NavItem[]; path: string }) {
  return (
    <nav aria-label="Tabs" className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-pill shadow-float md:hidden">
      <ul className="grid grid-cols-5">
        {items.map((n) => {
          const Icon = TAB_ICONS[n.href] ?? House;
          const current = isCurrent(path, n.href);
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={current ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-ink-faint", current && "text-ink")}>
                <Icon aria-hidden className="size-5" strokeWidth={current ? 2 : 1.6} />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Signed-in frame: sticky top bar (logo, primary destinations, bell, account), a workspace row inside the manager and
 * ops areas, and a tab bar on phones.
 */
export function Shell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const scrolled = useScrolled();
  const nav = navFor(me);
  const area = areaOf(path);
  const org = search?.get("org");
  const workspaces = [...(nav.manager.length > 0 ? [{ href: "/organization", label: "Manager workspace" }] : []), ...(nav.ops.length > 0 ? [{ href: "/ops", label: "Operations" }] : [])];
  const workspaceRow = area === "manager" && nav.manager.length > 0
    ? <WorkspaceNav label="Manager" items={nav.manager} path={path} query={org ? `?org=${org}` : undefined} />
    : area === "ops" && nav.ops.length > 0
      ? <WorkspaceNav label="Operations" items={nav.ops.flatMap((g) => g.items)} path={path} />
      : null;
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-pill focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">Skip to content</a>
      <header className={cn("sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300", scrolled || (workspaceRow && area !== "manager" && area !== "ops") ? "glass border-x-0 border-t-0 border-b-line" : "border-transparent", (area === "manager" || area === "ops") && "max-lg:glass max-lg:border-x-0 max-lg:border-t-0 max-lg:border-b-line")}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Link href="/home" className="flex min-h-11 items-center" aria-label="Bytesac home">
            <Logo size={26} className="hidden sm:inline-flex" />
            <Mark size={26} className="sm:hidden" />
          </Link>
          <div className="flex flex-1 justify-center"><PrimaryNav items={nav.primary} path={path} /></div>
          <div className="flex items-center gap-1.5">
            {workspaces.map((w) => (
              <Link key={w.href} href={w.href} aria-current={isCurrent(path, w.href) ? "page" : undefined}
                className={cn("hidden min-h-11 items-center rounded-pill px-3 text-sm text-ink-muted hover:text-ink lg:inline-flex", isCurrent(path, w.href) && "text-ink")}>
                {w.href === "/ops" ? "Ops" : "Manager"}
              </Link>
            ))}
            <NotificationsBell />
            <AccountMenu me={me} workspaces={workspaces} />
          </div>
        </div>
        {workspaceRow && <div className={cn("mx-auto max-w-7xl px-4 sm:px-6 lg:px-10", (area === "manager" || area === "ops") && "lg:hidden")}>{workspaceRow}</div>}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 pt-6 pb-32 sm:px-6 md:pt-10 md:pb-20 lg:px-10">{children}</main>
      {area !== "ops" && <TabBar items={nav.tabs} path={path} />}
    </div>
  );
}

/** For signed-in areas: the user comes from the session. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return <PublicShell>{children}</PublicShell>;
  return <Shell me={me}>{children}</Shell>;
}

/** For public pages a signed-out visitor sees: marketing header and footer around a content frame. */
export function PublicShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader />
      <main id="main" className={cn("flex-1", !bare && "mx-auto w-full max-w-7xl px-4 pt-28 pb-24 sm:px-6 lg:px-10")}>{children}</main>
      <SiteFooter />
    </div>
  );
}
