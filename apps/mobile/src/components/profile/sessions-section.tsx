import { ApiError } from "@repo/api-client";
import { describeError, formatRelative } from "@repo/app-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react-native";
import { Alert, Pressable, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

function errorText(e: unknown): string {
  return describeError(e instanceof ApiError ? e.code : "INTERNAL").title;
}

export function SessionsSection() {
  const qc = useQueryClient();
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const { data, isError } = useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeSession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  // signOut() clears the query cache and the local session.
  const all = useMutation({ mutationFn: () => api.logoutAll(), onSuccess: () => signOut({ remote: false, disconnect: true }) });

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
      <AppText variant="heading" accessibilityRole="header">Sessions</AppText>
      <AppText variant="micro" tone="faint">Swipe another device left to revoke it.</AppText>
      {isError && <AppText tone="danger" accessibilityRole="alert">{"Couldn't load sessions. Try again later."}</AppText>}
      {revoke.isError && <AppText tone="danger" accessibilityRole="alert">{errorText(revoke.error)}</AppText>}
      {all.isError && <AppText tone="danger" accessibilityRole="alert">{errorText(all.error)}</AppText>}
      {data && data.sessions.length === 0 && <AppText tone="faint">No active sessions.</AppText>}
      {data?.sessions.map((s) => {
        const Icon = s.client === "mobile" ? Smartphone : Monitor;
        return (
          <Swipeable key={s.id} enabled={!s.current} friction={2} rightThreshold={48} overshootRight={false}
            renderRightActions={() => (
              <Pressable accessibilityRole="button" accessibilityLabel="Revoke session" onPress={() => revoke.mutate(s.id)}
                className="ml-2 w-24 items-center justify-center rounded-tile bg-danger"><AppText variant="label" tone="primaryInk">Revoke</AppText></Pressable>
            )}>
          <View className="gap-2 border-t border-line bg-surface pt-3">
            <View className="flex-row items-center gap-2">
              <Icon size={16} color={colors.inkMuted} />
              <AppText className="font-medium">{s.client === "mobile" ? "Mobile app" : "Web"}</AppText>
              {s.current && <StatusBadge tone="success" label="This device" />}
            </View>
            <AppText variant="label" tone="faint" numberOfLines={1}>{s.userAgent ?? "Unknown device"}</AppText>
            <AppText variant="label" tone="faint">{s.ipPrefix ?? ""} · last seen {formatRelative(s.lastSeenAt)}</AppText>
            {!s.current && <Button variant="ghost" size="sm" className="self-start" disabled={revoke.isPending} onPress={() => revoke.mutate(s.id)}>Revoke</Button>}
          </View>
          </Swipeable>
        );
      })}
      <Button variant="secondary" loading={all.isPending} onPress={confirmAll}>Log out all devices</Button>
    </Card>
  );
}
