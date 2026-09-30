import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { MeProvider } from "@/components/me-context";
import { getServerMe } from "@/lib/server-me";

const linkCls = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone hover:text-ivory";

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const me = await getServerMe();
  if (!me) redirect("/sign-in?reason=expired");
  const isAdmin = me.platformRoles.includes("ops_admin");
  // UI guard only: every ops API call re-checks the role server-side.
  const allowed = isAdmin || me.platformRoles.includes("ops_reviewer");
  return (
    <div className="min-h-screen bg-space">
      <header className="border-b border-border-dark bg-slate/60">
        <nav aria-label="Ops" className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-4 px-4 md:px-8">
          <span className="flex items-center gap-2"><Logo size={28} /><span className="font-display text-lg font-bold text-ivory">Ops</span></span>
          {allowed && <Link href="/ops/applications" className={linkCls}>Applications</Link>}
          {allowed && <Link href="/ops/organizations" className={linkCls}>Organizations</Link>}
          {allowed && <Link href="/ops/members" className={linkCls}>Members</Link>}
          {allowed && <Link href="/ops/assets" className={linkCls}>Assets</Link>}
          {isAdmin && <Link href="/ops/roles" className={linkCls}>Roles</Link>}
          <Link href="/home" className={`${linkCls} ml-auto`}>Back to Home</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        {allowed ? <MeProvider initial={me}>{children}</MeProvider> : <p role="alert" className="text-base text-ivory">You don&apos;t have access to this area.</p>}
      </main>
    </div>
  );
}
