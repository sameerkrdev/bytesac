import { MEMBERSHIP_ROLE_LABEL } from "@repo/app-core";
import { ORGANIZATION_FIELD_KEYS, ORGANIZATION_FIELDS } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, ChevronRight, ExternalLink } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";
import { ErrorState, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { Monogram } from "@/components/ui/monogram";
import { Screen, Section } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const month = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** A verified organization: who they are, their public catalog fields, published baskets and the team that opted in. */
export default function OrganizationScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["organization", id], queryFn: () => api.getPublicOrganization(id) });
  if (q.isPending) return <Screen edges={["left", "right"]}><LoadingState /></Screen>;
  if (q.isError) return <Screen edges={["left", "right"]}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const org = q.data;
  // Render only catalog fields marked public, whatever the response holds.
  const fields = ORGANIZATION_FIELD_KEYS.filter((k) => ORGANIZATION_FIELDS[k].visibility === "public" && typeof org.profile[k] === "string" && org.profile[k] !== "");
  const name = String(org.profile.displayName ?? "Organization");
  const about = fields.includes("about") ? String(org.profile.about) : null;
  const website = fields.includes("website") && String(org.profile.website).startsWith("https://") ? String(org.profile.website) : null;
  return (
    <Screen edges={["left", "right"]} backdrop={<Sky height={300} />}>
      <View className="gap-3 pt-16">
        <Monogram name={name} size={56} />
        <AppText variant="eyebrow" tone="muted">Organization</AppText>
        <AppText variant="display" accessibilityRole="header">{name}</AppText>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="flex-row items-center gap-1 rounded-pill bg-success-soft px-2.5 py-1">
            <BadgeCheck size={13} color={colors.success} />
            <AppText variant="micro" tone="success">Verified</AppText>
          </View>
          <AppText variant="label" tone="muted">{`${org.type === "firm" ? "Firm" : "Individual manager"} · ${org.jurisdiction} · since ${month(org.verifiedAt)}`}</AppText>
        </View>
        {about ? <AppText variant="lede">{about}</AppText> : null}
      </View>

      {org.baskets.length > 0 ? (
        <Section title="Baskets">
          <Card className="py-1">
            {org.baskets.map((b, i) => (
              <Pressable key={b.slug} accessibilityRole="link" accessibilityLabel={b.name} onPress={() => router.push(`/basket/${b.slug}`)}
                className={`min-h-14 flex-row items-center justify-between gap-3 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}>
                <AppText className="flex-1 font-medium">{b.name}</AppText>
                <ChevronRight size={16} color={colors.inkFaint} />
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {fields.filter((k) => k !== "displayName" && k !== "about" && k !== "website").map((k) => (
        <View key={k} className="gap-1.5">
          <AppText variant="eyebrow" tone="faint">{ORGANIZATION_FIELDS[k].label}</AppText>
          <AppText>{String(org.profile[k])}</AppText>
        </View>
      ))}
      {website ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`${name} website`} onPress={() => void Linking.openURL(website)} className="min-h-11 flex-row items-center gap-1.5 self-start">
          <AppText tone="accent">{website.replace(/^https:\/\//, "")}</AppText><ExternalLink size={14} color={colors.accent} />
        </Pressable>
      ) : null}

      {([["Current team", org.team.current], ["Former members", org.team.former]] as const).map(([title, members]) => members.length > 0 && (
        <Section key={title} title={title}>
          <Card className="py-1">
            {members.map((m, i) => (
              <View key={i} className={`flex-row items-center gap-3 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
                <Monogram name={m.displayName} />
                <View className="flex-1 gap-0.5">
                  <AppText className="font-medium">{m.displayName}</AppText>
                  <AppText variant="micro" tone="faint">{`${m.title ? `${m.title}, ` : ""}${MEMBERSHIP_ROLE_LABEL[m.role]}${"to" in m ? ` · ${month(m.from)} to ${month(m.to)}` : ""}`}</AppText>
                </View>
              </View>
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}
