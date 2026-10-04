import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Breadcrumb, type Crumb } from "@/components/layout/page-layout";

/** Initials in a soft disc — no photos are collected, so none are shown. */
export function Monogram({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).slice(0, 2).join("");
  return (
    <span aria-hidden className={size === "lg" ? "grid size-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky2 to-sky3 text-2xl font-light text-ink ring-4 ring-surface/70" : "grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-ink-muted"}>
      {initials}
    </span>
  );
}

export const VerifiedBadge = () => (
  <span className="inline-flex items-center gap-1.5 rounded-pill bg-success-soft px-2.5 py-1 text-xs font-medium text-success"><BadgeCheck aria-hidden className="size-3.5" />Verified by Bytesac</span>
);

/** Header for public profiles (managers, organizations): atmosphere band, monogram, name, badges and meta. */
export function ProfileHero({ name, crumbs, eyebrow, meta, children }: { name: string; crumbs: Crumb[]; eyebrow: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="atmosphere overflow-hidden rounded-shell border border-line px-6 pt-6 pb-10 sm:px-10 sm:pt-8">
      <Breadcrumb items={crumbs} />
      <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end">
        <Monogram name={name} size="lg" />
        <div className="min-w-0 space-y-3">
          <p className="type-eyebrow text-ink-muted">{eyebrow}</p>
          <h1 className="type-display text-ink">{name}</h1>
          {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">{meta}</div>}
        </div>
      </div>
      {children && <div className="mt-8 max-w-2xl">{children}</div>}
    </header>
  );
}
