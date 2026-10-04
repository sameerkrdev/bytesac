import type { Metadata } from "next";
import { StatusView } from "@/components/managers/status-view";

export const metadata: Metadata = { title: "Application status", referrer: "no-referrer" };

export default function StatusPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3">
        <p className="type-eyebrow text-ink-faint">Manager application</p>
        <h1 className="type-title text-ink">Application status</h1>
      </div>
      <div className="rounded-shell border border-line bg-surface p-6 shadow-soft sm:p-8"><StatusView /></div>
    </div>
  );
}
