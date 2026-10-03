import { ELIGIBILITY_ATTESTATION, INVESTOR_STATUSES, type InvestorStatus } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { palette } from "@repo/design-tokens";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";

export const STATUS_LABEL: Record<InvestorStatus, { title: string; help: string }> = {
  retail: { title: "Retail investor", help: "You invest as an individual and do not meet an accredited, qualified or professional test." },
  accredited: { title: "Accredited investor", help: "You meet your country's accredited-investor test (for example income or net worth thresholds)." },
  qualified: { title: "Qualified investor", help: "You meet your country's qualified-investor test, for example by experience or portfolio size." },
  professional: { title: "Professional investor", help: "You work in or are treated as a professional in financial markets." },
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const regionNames = (): Intl.DisplayNames | null => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
};
/** Two-letter region codes whose display name is not just the code (when the runtime has Intl.DisplayNames, else every code). */
const countries = (): { code: string; name: string }[] => {
  const names = regionNames();
  const out: { code: string; name: string }[] = [];
  for (const a of LETTERS) for (const b of LETTERS) {
    const code = a + b;
    const name = names?.of(code);
    if (!names) out.push({ code, name: code });
    else if (name && name !== code) out.push({ code, name });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
};
export const countryName = (code: string) => regionNames()?.of(code) ?? code;

/** Country (search, then tap), investor status and attestation. The server decides what the declaration allows; this only records it. */
export function DeclarationForm({ onSaved }: { onSaved?(): void }) {
  const qc = useQueryClient();
  const list = useMemo(() => countries(), []);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<InvestorStatus | "">("");
  const [agreed, setAgreed] = useState(false);
  const save = useMutation({
    mutationFn: () => api.declareEligibility({ country, investorStatus: status as InvestorStatus, attestationVersion: ELIGIBILITY_ATTESTATION.version }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["eligibility"] }); onSaved?.(); },
  });
  const ready = country !== "" && status !== "" && agreed;
  const q = search.trim().toLowerCase();
  const matches = country || q.length < 2 ? [] : list.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q).slice(0, 6);

  return (
    <View className="gap-4">
      {country ? (
        <View className="flex-row items-center justify-between gap-3">
          <AppText>Country: {countryName(country)}</AppText>
          <Button variant="ghost" onPress={() => { setCountry(""); setSearch(""); }}>Change country</Button>
        </View>
      ) : (
        <>
          <TextField label="Country of residence" value={search} onChangeText={setSearch} placeholder="Type to search" autoCorrect={false} />
          {matches.map((c) => (
            <Pressable key={c.code} accessibilityRole="button" accessibilityLabel={c.name} className="min-h-11 justify-center rounded-xl border border-border-dark px-3" onPress={() => setCountry(c.code)}>
              <AppText>{c.name}</AppText>
            </Pressable>
          ))}
        </>
      )}
      <View accessibilityRole="radiogroup" className="gap-2">
        <AppText variant="label">Investor status</AppText>
        {INVESTOR_STATUSES.map((s) => (
          <Pressable key={s} accessibilityRole="radio" accessibilityLabel={STATUS_LABEL[s].title} accessibilityState={{ checked: status === s }} onPress={() => setStatus(s)}
            className={`min-h-11 gap-1 rounded-xl border px-3 py-2 ${status === s ? "border-mint" : "border-border-dark"}`}>
            <AppText>{STATUS_LABEL[s].title}</AppText>
            <AppText variant="label" tone="stone">{STATUS_LABEL[s].help}</AppText>
          </Pressable>
        ))}
      </View>
      <View className="min-h-11 flex-row items-start gap-3">
        <Switch accessibilityLabel="I confirm the declaration is true" value={agreed} onValueChange={setAgreed} trackColor={{ true: palette.sage, false: palette.slate }} thumbColor={palette.ivory} />
        <AppText variant="label" tone="stone" className="flex-1">{ELIGIBILITY_ATTESTATION.text}</AppText>
      </View>
      <Button disabled={!ready} loading={save.isPending} onPress={() => save.mutate()}>Save declaration</Button>
      <ErrorText error={save.error} />
    </View>
  );
}
