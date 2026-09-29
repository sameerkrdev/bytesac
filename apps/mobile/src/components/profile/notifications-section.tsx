import { ApiError, describeError } from "@repo/api-client";
import type { NotificationPreferences } from "@repo/contracts";
import { palette } from "@repo/design-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";

const ITEMS: { key: keyof NotificationPreferences; label: string; hint: string }[] = [
  { key: "rebalance", label: "Rebalances", hint: "New basket versions you can apply or skip" },
  { key: "portfolioUpdates", label: "Portfolio updates", hint: "Drift and execution status" },
  { key: "managerUpdates", label: "Manager updates", hint: "Strategy and commentary from managers" },
  { key: "offers", label: "Offers", hint: "Promotions and offers" },
  { key: "productUpdates", label: "Product updates", hint: "New Bytesac features" },
  { key: "marketing", label: "Marketing", hint: "News and campaigns" },
];

export function NotificationsSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["prefs"], queryFn: () => api.getPreferences() });
  const m = useMutation({ mutationFn: (p: Partial<NotificationPreferences>) => api.updatePreferences(p), onSuccess: (next) => qc.setQueryData(["prefs"], next) });
  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Notifications</AppText>
      {isLoading && <AppText tone="stone">Loading preferences…</AppText>}
      {isError && <AppText tone="danger" accessibilityRole="alert">{"Couldn't load preferences. Try again later."}</AppText>}
      {data && ITEMS.map((it) => (
        <View key={it.key} className="min-h-11 flex-row items-center justify-between gap-4">
          <View className="flex-1">
            <AppText>{it.label}</AppText>
            <AppText variant="label" tone="stone">{it.hint}</AppText>
          </View>
          <Switch accessibilityLabel={it.label} value={data[it.key]} disabled={m.isPending}
            trackColor={{ true: palette.sage, false: palette.slate }} thumbColor={palette.ivory}
            onValueChange={(v) => m.mutate({ [it.key]: v })} />
        </View>
      ))}
      {m.isError && <AppText tone="danger" accessibilityRole="alert">{describeError(m.error instanceof ApiError ? m.error.code : "INTERNAL").title}</AppText>}
      <AppText variant="label" tone="stone">Security and account notices are always sent.</AppText>
    </Card>
  );
}
