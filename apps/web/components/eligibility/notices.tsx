import { blockedAssetNotices } from "@repo/app-core/eligibility-copy";

/** Basket page notices: per asset for a signed-in user, one line for a signed-out visitor. */
export function EligibilityNotices({ eligibility, names }: { eligibility: { requirements: boolean; assets?: { instrumentId: string; outcome: string }[] }; names: Record<string, string> }) {
  if (!eligibility.requirements) return null;
  if (!eligibility.assets) return <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">Some assets have eligibility requirements</p>;
  const blocked = blockedAssetNotices(eligibility.assets);
  if (blocked.length === 0) return null;
  return (
    <ul aria-label="Eligibility" className="space-y-1 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
      {blocked.map((a) => <li key={a.instrumentId}>{names[a.instrumentId] ?? "An asset"}: {a.text}</li>)}
    </ul>
  );
}
