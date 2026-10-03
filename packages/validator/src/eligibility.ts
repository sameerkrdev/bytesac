import { z } from "zod";

export const INVESTOR_STATUSES = ["retail", "accredited", "qualified", "professional"] as const;
export const investorStatusSchema = z.enum(INVESTOR_STATUSES);
export type InvestorStatus = z.infer<typeof investorStatusSchema>;
export const DECLARATION_TTL_DAYS = 365;
/** Placeholder wording; compliance to confirm (open item). */
export const ELIGIBILITY_ATTESTATION = {
  version: "2026-10-03",
  text: "I confirm that the country of residence and investor status I declare are true and current, and that I am responsible for complying with the laws that apply to me. I understand Bytesac relies on this declaration to decide which tokenized assets it can offer me.",
} as const;

export const eligibilityDeclarationInputSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  investorStatus: investorStatusSchema,
  attestationVersion: z.literal(ELIGIBILITY_ATTESTATION.version),
});
export type EligibilityDeclarationInput = z.infer<typeof eligibilityDeclarationInputSchema>;

export const eligibilityDeclarationViewSchema = z.object({
  country: z.string(),
  investorStatus: investorStatusSchema,
  attestationVersion: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  expired: z.boolean(),
});
export type EligibilityDeclarationView = z.infer<typeof eligibilityDeclarationViewSchema>;

const SEVERITY = { RESTRICTED: 3, KYC_REQUIRED: 2, REVIEW_REQUIRED: 1, ALLOWED: 0 } as const;
type StoredOutcome = keyof typeof SEVERITY;
export interface EligibilityRuleInput {
  id: string; instrumentId: string; routeId: string | null; jurisdiction: string; action: "acquire" | "sell" | "redeem" | "transfer";
  outcome: StoredOutcome; investorStatuses: InvestorStatus[]; status: "DRAFT" | "ACTIVE" | "RETIRED";
}
export interface EligibilityResult {
  outcome: StoredOutcome | "DECLARATION_REQUIRED"; ruleIds: string[];
  reason: "RULE" | "NO_RULE" | "IP_COUNTRY_MISMATCH" | "DECLARATION_REQUIRED" | "NO_RULE_CRYPTO";
}

/** Spec 11 section 6: pure context eligibility. RWAs are denied by default; crypto without a matching rule is allowed. */
export function evaluateEligibility(i: {
  rwa: boolean; instrumentId: string; routeId: string | null; action: "acquire" | "sell"; rules: EligibilityRuleInput[];
  declaration: { country: string; investorStatus: InvestorStatus; createdAt: Date } | null; ipCountry: string | null; now: Date;
}): EligibilityResult {
  const fresh = i.declaration && i.now.getTime() - i.declaration.createdAt.getTime() <= DECLARATION_TTL_DAYS * 86_400_000 ? i.declaration : null;
  if (i.rwa && !fresh) return { outcome: "DECLARATION_REQUIRED", ruleIds: [], reason: "DECLARATION_REQUIRED" };
  const ip = i.ipCountry && !["XX", "T1"].includes(i.ipCountry) ? i.ipCountry : null;
  if (i.rwa && ip && ip !== fresh!.country) return { outcome: "REVIEW_REQUIRED", ruleIds: [], reason: "IP_COUNTRY_MISMATCH" };
  const candidates = i.rules.filter((r) => r.status === "ACTIVE" && r.instrumentId === i.instrumentId && r.action === i.action
    && (r.routeId === null || r.routeId === i.routeId)
    && (r.jurisdiction === "*" || (fresh !== null && r.jurisdiction === fresh.country))
    && (r.investorStatuses.length === 0 || (fresh !== null && r.investorStatuses.includes(fresh.investorStatus))));
  // Tiers, most specific first: route+country, route+*, instrument+country, instrument+*.
  const tiers = [
    candidates.filter((r) => r.routeId !== null && r.jurisdiction !== "*"), candidates.filter((r) => r.routeId !== null && r.jurisdiction === "*"),
    candidates.filter((r) => r.routeId === null && r.jurisdiction !== "*"), candidates.filter((r) => r.routeId === null && r.jurisdiction === "*"),
  ];
  const tier = tiers.find((t) => t.length > 0);
  if (!tier) return i.rwa ? { outcome: "RESTRICTED", ruleIds: [], reason: "NO_RULE" } : { outcome: "ALLOWED", ruleIds: [], reason: "NO_RULE_CRYPTO" };
  const worst = tier.reduce((w, r) => (SEVERITY[r.outcome] > SEVERITY[w.outcome] ? r : w));
  return { outcome: worst.outcome, ruleIds: tier.filter((r) => r.outcome === worst.outcome).map((r) => r.id), reason: "RULE" };
}
