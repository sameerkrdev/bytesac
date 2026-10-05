import { BASKET_STATUS_LABEL } from "@repo/app-core";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const month = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** A manager's public profile: headline, bio, background, qualifications (self-reported ones marked), baskets and organizations. */
export default function ManagerScreen() {
  const { colors } = useTheme();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const q = useQuery({ queryKey: ["manager", handle], queryFn: () => api.getPublicManager(handle) });
  if (q.isPending) return <Screen edges={["left", "right"]}><LoadingState /></Screen>;
  if (q.isError) return <Screen edges={["left", "right"]}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const m = q.data;
  const self = (k: "experienceYears" | "qualifications") => (m.selfReported.includes(k) ? " · self-reported" : "");
  const links = m.links.filter((l) => l.url.startsWith("https://"));
  return (
    <Screen edges={["left", "right"]} backdrop={<Sky height={300} />}>
      <View className="gap-3 pt-16">
        <Monogram name={m.displayName} size={56} />
        <AppText variant="eyebrow" tone="muted">{`Manager · @${m.handle}`}</AppText>
        <AppText variant="display" accessibilityRole="header">{m.displayName}</AppText>
        {m.verified ? (
          <View className="flex-row">
            <View className="flex-row items-center gap-1 rounded-pill bg-success-soft px-2.5 py-1">
              <BadgeCheck size={13} color={colors.success} />
              <AppText variant="micro" tone="success">Verified organization member</AppText>
            </View>
          </View>
        ) : null}
        {m.headline ? <AppText variant="lede">{m.headline}</AppText> : null}
      </View>

      {m.bio ? <AppText tone="muted">{m.bio}</AppText> : null}

      {m.experienceYears !== null || m.background || m.qualifications.length > 0 ? (
        <Card className="gap-4">
          {m.experienceYears !== null ? (
            <View className="gap-0.5"><AppText variant="micro" tone="faint">{`Experience${self("experienceYears")}`}</AppText><AppText>{`${m.experienceYears} years`}</AppText></View>
          ) : null}
          {m.background ? <View className="gap-0.5"><AppText variant="micro" tone="faint">Background</AppText><AppText>{m.background}</AppText></View> : null}
          {m.qualifications.length > 0 ? (
            <View className="gap-1.5">
              <AppText variant="micro" tone="faint">{`Qualifications${self("qualifications")}`}</AppText>
              <View className="flex-row flex-wrap gap-1.5">
                {m.qualifications.map((x) => <View key={x} className="rounded-pill bg-surface-muted px-3 py-1.5"><AppText variant="micro" tone="muted">{x}</AppText></View>)}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      {m.baskets.length > 0 ? (
        <Section title="Baskets">
          <Card className="py-1">
            {m.baskets.map((b, i) => {
              const s = BASKET_STATUS_LABEL[b.status];
              return (
                <Pressable key={`${b.slug}-${b.from}`} accessibilityRole="link" accessibilityLabel={b.name} onPress={() => router.push(`/basket/${b.slug}`)}
                  className={`flex-row items-center gap-3 py-3.5 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}>
                  <View className="flex-1 gap-0.5">
                    <AppText className="font-medium">{b.name}</AppText>
                    <AppText variant="micro" tone="faint">{`${b.role === "lead" ? "Lead" : "Co-manager"} · ${month(b.from)}${b.to ? ` to ${month(b.to)}` : " to now"}`}</AppText>
                  </View>
                  {b.status !== "ACTIVE" ? <StatusBadge tone={s.tone} label={s.label} /> : null}
                  <ChevronRight size={16} color={colors.inkFaint} />
                </Pressable>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {m.organizations.length > 0 ? (
        <Section title="Organizations">
          <Card className="py-1">
            {m.organizations.map((o, i) => (
              <Pressable key={`${o.organizationId}-${o.from}`} accessibilityRole="link" accessibilityLabel={o.organizationName ?? "Organization"} onPress={() => router.push(`/organization/${o.organizationId}`)}
                className={`flex-row items-center gap-3 py-3.5 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}>
                <View className="flex-1 gap-0.5">
                  <AppText className="font-medium">{o.organizationName ?? "Organization"}</AppText>
                  <AppText variant="micro" tone="faint">{`${o.title ?? o.role}${o.current ? " · current" : ` · ${month(o.from)}${o.to ? ` to ${month(o.to)}` : ""}`}`}</AppText>
                </View>
                <ChevronRight size={16} color={colors.inkFaint} />
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {links.map((l) => (
        <Pressable key={l.url} accessibilityRole="link" accessibilityLabel={l.label} onPress={() => void Linking.openURL(l.url)} className="min-h-11 flex-row items-center gap-1.5 self-start">
          <AppText tone="accent">{l.label}</AppText><ExternalLink size={14} color={colors.accent} />
        </Pressable>
      ))}
    </Screen>
  );
}
