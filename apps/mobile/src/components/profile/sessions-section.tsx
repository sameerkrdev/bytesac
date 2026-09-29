import { ApiError, describeError } from "@repo/api-client";
import { palette } from "@repo/design-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react-native";
import { Alert, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatRelative } from "@/lib/format";

function errorText(e: unknown): string {
  return describeError(e instanceof ApiError ? e.code : "INTERNAL").title;
}

export function SessionsSection() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { data, isError } = useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  // signOut() clears the query cache and the local session.
  const all = useMutation({ mutationFn: () => api.logoutAll(), onSuccess: () => signOut() });

  const confirmAll = () => Alert.alert(
    "Log out of all devices?",
    "Every session, including this one, ends. You'll sign in with your wallet again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Log out everywhere", style: "destructive", onPress: () => all.mutate() },
    ],
  );

  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Sessions</AppText>
      {isError && <AppText tone="danger" accessibilityRole="alert">{"Couldn't load sessions. Try again later."}</AppText>}
      {revoke.isError && <AppText tone="danger" accessibilityRole="alert">{errorText(revoke.error)}</AppText>}
      {all.isError && <AppText tone="danger" accessibilityRole="alert">{errorText(all.error)}</AppText>}
      {data && data.sessions.length === 0 && <AppText tone="stone">No active sessions.</AppText>}
      {data?.sessions.map((s) => {
        const Icon = s.client === "mobile" ? Smartphone : Monitor;
        return (
          <View key={s.id} className="gap-2 border-t border-border-dark pt-3">
            <View className="flex-row items-center gap-2">
              <Icon size={16} color={palette.stone} />
              <AppText className="font-sans-medium">{s.client === "mobile" ? "Mobile app" : "Web"}</AppText>
              {s.current && <StatusBadge tone="success" label="This device" />}
            </View>
            <AppText variant="label" tone="stone" numberOfLines={1}>{s.userAgent ?? "Unknown device"}</AppText>
            <AppText variant="label" tone="stone">{s.ipPrefix ?? ""} · last seen {formatRelative(s.lastSeenAt)}</AppText>
            {!s.current && <Button variant="ghost" disabled={revoke.isPending} onPress={() => revoke.mutate(s.id)}>Revoke</Button>}
          </View>
        );
      })}
      <Button variant="destructive" loading={all.isPending} onPress={confirmAll}>Log out all devices</Button>
    </Card>
  );
}
