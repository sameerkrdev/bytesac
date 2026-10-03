/** What the user sees for a tokenized asset they can't buy; the server decides the outcome, this only words it. */
export const OUTCOME_NOTICE: Record<string, string> = {
  RESTRICTED: "Not available in your region / for your investor status",
  KYC_REQUIRED: "Identity verification required — not available yet",
  REVIEW_REQUIRED: "Needs review — contact support",
  DECLARATION_REQUIRED: "Declare your country and investor status in your profile to see availability",
};

/** Basket page notices: per asset for a signed-in user, one line for a signed-out visitor. */
export function EligibilityNotices({ eligibility, names }: { eligibility: { requirements: boolean; assets?: { instrumentId: string; outcome: string }[] }; names: Record<string, string> }) {
  if (!eligibility.requirements) return null;
  if (!eligibility.assets) return <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">Some assets have eligibility requirements</p>;
  const blocked = eligibility.assets.filter((a) => OUTCOME_NOTICE[a.outcome]);
  if (blocked.length === 0) return null;
  return (
    <ul aria-label="Eligibility" className="space-y-1 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
      {blocked.map((a) => <li key={a.instrumentId}>{names[a.instrumentId] ?? "An asset"}: {OUTCOME_NOTICE[a.outcome]}</li>)}
    </ul>
  );
}
