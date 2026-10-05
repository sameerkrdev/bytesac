import type { MeResponse } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Check, ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Item = { key: string; title: string; hint: string; done: boolean; go(): void };

const verified = (me: MeResponse, type: "email" | "phone") => me.contacts.some((c) => c.type === type && c.status === "verified");

/**
 * Account completion: what is still missing before investing (verified email and phone) and what some baskets need
 * (an eligibility declaration for tokenized assets, both Solana and EVM accounts). Hidden once everything is done.
 * It only points to the screens that fix each item; the server still decides eligibility.
 */
export function SetupChecklist({ me }: { me: MeResponse }) {
  const { colors } = useTheme();
  const eligibility = useQuery({ queryKey: ["eligibility"], queryFn: () => api.getEligibility(), retry: false });
  const active = me.wallet.addresses.filter((a) => a.status === "active");
  const hasSolana = active.some((a) => a.chain === "solana");
  const hasEvm = active.some((a) => a.chain !== "solana" && a.chain !== "bitcoin");
  const declared = eligibility.data?.declaration ? !eligibility.data.declaration.expired : false;
  const profile = () => router.push("/(app)/(tabs)/profile");
  const items: Item[] = [
    { key: "email", title: "Verify your email", hint: "Needed to invest", done: verified(me, "email"), go: () => router.push("/(auth)/contact") },
    { key: "phone", title: "Verify your phone", hint: "Needed to invest", done: verified(me, "phone"), go: () => router.push("/(auth)/contact") },
    { key: "wallets", title: hasSolana ? "Add an EVM account" : "Add a Solana account", hint: "Baskets can hold assets on Solana and EVM networks", done: hasSolana && hasEvm, go: profile },
    { key: "eligibility", title: "Declare country and investor status", hint: "Needed for tokenized real-world assets", done: declared, go: profile },
  ];
  const done = items.filter((i) => i.done).length;
  if (eligibility.isPending || done === items.length) return null;
  return (
    <View accessibilityLabel="Finish setting up" className="gap-3 rounded-card border border-line bg-surface p-5">
      <View className="flex-row items-center justify-between">
        <AppText variant="heading" accessibilityRole="header">Finish setting up</AppText>
        <AppText variant="label" tone="muted">{`${done} of ${items.length}`}</AppText>
      </View>
      <View className="h-1.5 overflow-hidden rounded-pill bg-surface-muted">
        <View className="h-full rounded-pill bg-success" style={{ width: `${(done / items.length) * 100}%` }} />
      </View>
      {items.map((it) => (
        <Pressable key={it.key} accessibilityRole={it.done ? undefined : "button"} accessibilityLabel={`${it.title}${it.done ? ", done" : ""}`} disabled={it.done} onPress={it.go}
          className="min-h-12 flex-row items-center gap-3 active:opacity-70">
          <View className={`size-6 items-center justify-center rounded-pill ${it.done ? "bg-success" : "border border-line-strong"}`}>
            {it.done ? <Check size={13} color={colors.primaryInk} strokeWidth={2.5} /> : null}
          </View>
          <View className="flex-1 gap-0.5">
            <AppText tone={it.done ? "faint" : "ink"} className={it.done ? "line-through" : "font-medium"}>{it.title}</AppText>
            {!it.done ? <AppText variant="micro" tone="faint">{it.hint}</AppText> : null}
          </View>
          {!it.done ? <ChevronRight size={16} color={colors.inkFaint} /> : null}
        </Pressable>
      ))}
    </View>
  );
}
