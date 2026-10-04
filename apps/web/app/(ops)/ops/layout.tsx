import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { OpsFrame } from "@/components/ops/ops-sidebar";
import { MeProvider } from "@/components/me-context";
import { getServerMe } from "@/lib/server-me";

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const me = await getServerMe();
  if (!me) redirect("/sign-in?reason=expired");
  // UI guard only: every ops API call re-checks the role server-side.
  const allowed = me.platformRoles.includes("ops_admin") || me.platformRoles.includes("ops_reviewer");
  return (
    <MeProvider initial={me}>
      <AppShell>{allowed ? <OpsFrame>{children}</OpsFrame> : <p role="alert" className="text-base text-ink">You don&apos;t have access to this area.</p>}</AppShell>
    </MeProvider>
  );
}
