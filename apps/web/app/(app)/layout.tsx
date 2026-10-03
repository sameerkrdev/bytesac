import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { MeProvider } from "@/components/me-context";
import { getServerMe } from "@/lib/server-me";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getServerMe();
  if (!me) redirect("/sign-in?reason=expired");
  return <MeProvider initial={me}><AppShell>{children}</AppShell></MeProvider>;
}
