"use client";
import { WALLET_HELP } from "@repo/app-core";
import { useEffect } from "react";
import { PageLayout } from "@/components/layout/page-layout";

/** How wallets work. Each question is a disclosure with id = its topic, so /help/wallets#move-chain opens that answer. */
export default function WalletHelpPage() {
  useEffect(() => {
    const openHash = () => {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el instanceof HTMLDetailsElement) { el.open = true; el.scrollIntoView?.(); }
    };
    openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, []);
  return (
    <PageLayout title="How wallets work" eyebrow="Help" description="Linking, moving and signing with more than one wallet.">
      <div className="max-w-3xl space-y-3 [&>details]:scroll-mt-28">
        {WALLET_HELP.map((h) => (
          <details key={h.id} id={h.id} className="group rounded-card border border-line bg-surface p-5">
            <summary className="flex min-h-11 cursor-pointer items-center type-heading text-ink">{h.question}</summary>
            <div className="mt-3 space-y-3 text-sm text-ink-muted">{h.answer.map((p) => <p key={p}>{p}</p>)}</div>
          </details>
        ))}
      </div>
    </PageLayout>
  );
}
