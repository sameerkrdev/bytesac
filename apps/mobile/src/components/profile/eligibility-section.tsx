import { useQuery } from "@tanstack/react-query";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { countryName, DeclarationForm, STATUS_LABEL } from "@/components/eligibility/declaration-form";
import { ErrorText, LoadingState } from "@/components/states/states";
import { api } from "@/lib/api";

/** The user's country and investor status, needed to buy tokenized assets. A new declaration replaces the current one. */
export function EligibilitySection() {
  const q = useQuery({ queryKey: ["eligibility"], queryFn: () => api.getEligibility() });
  const d = q.data?.declaration;
  return (
    <Card className="gap-4">
      <AppText variant="heading" accessibilityRole="header">Eligibility</AppText>
      <AppText tone="muted">Tokenized assets are offered by country and investor status. The declaration is valid for 365 days.</AppText>
      {q.isError ? <ErrorText error={q.error} /> : q.isPending ? <LoadingState /> : d ? (
        <>
          <AppText>{countryName(d.country)} · {STATUS_LABEL[d.investorStatus].title}</AppText>
          <StatusBadge tone={d.expired ? "danger" : "success"} label={d.expired ? "Expired" : `Valid until ${new Date(d.expiresAt).toLocaleDateString()}`} />
        </>
      ) : <AppText tone="faint">You have not declared yet.</AppText>}
      {!q.isPending && <DeclarationForm />}
    </Card>
  );
}
