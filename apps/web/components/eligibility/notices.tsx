import { blockedAssetNotices } from "@repo/app-core/eligibility-copy";
import { ShieldAlert } from "lucide-react";

/** Basket page notices: per asset for a signed-in user, one line for a signed-out visitor. */
export function EligibilityNotices({ eligibility, names }: { eligibility: { requirements: boolean; assets?: { instrumentId: string; outcome: string }[] }; names: Record<string, string> }) {
  if (!eligibility.requirements) return null;
  if (!eligibility.assets) return <p role="status" className="flex gap-3 rounded-tile border border-line bg-surface-muted p-4 text-sm text-ink"><ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-muted" />Some assets have eligibility requirements</p>;
  const blocked = blockedAssetNotices(eligibility.assets);
  if (blocked.length === 0) return null;
  return (
    <ul aria-label="Eligibility" className="space-y-1.5 rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm text-ink">
      {[...new Set(blocked.map((a) => a.text))].map((text) => <li key={text}>{blocked.filter((a) => a.text === text).map((a) => names[a.instrumentId] ?? "An asset").join(", ")}: {text}</li>)}
    </ul>
  );
}
