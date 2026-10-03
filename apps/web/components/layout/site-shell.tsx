import type { ReactNode } from "react";
import { AppShell, PublicShell } from "@/components/layout/app-shell";
import { MeProvider } from "@/components/me-context";
import { getServerMe } from "@/lib/server-me";

/** Public pages (discovery, fees, public profiles): the signed-in shell for a signed-in user, a plain header otherwise. */
export async function SiteShell({ children }: { children: ReactNode }) {
  const me = await getServerMe().catch(() => null);
  return me ? <MeProvider initial={me}><AppShell>{children}</AppShell></MeProvider> : <PublicShell>{children}</PublicShell>;
}
