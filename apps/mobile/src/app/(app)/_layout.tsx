import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

export default function AppLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();
  // Validates the stored token on cold start; a SESSION_EXPIRED/USER_NOT_ACTIVE error triggers the expiry sign-out.
  useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: status === "signedIn" });
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: "Geist_500Medium", color: colors.ink },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="basket/[slug]" options={{ title: "", headerTransparent: true, headerStyle: { backgroundColor: "transparent" } }} />
      <Stack.Screen name="position/[id]" options={{ title: "" }} />
      <Stack.Screen name="activity" options={{ title: "" }} />
      <Stack.Screen name="invest/[slug]" options={{ title: "" }} />
      <Stack.Screen name="operation/[id]" options={{ title: "" }} />
      <Stack.Screen name="rebalance/[positionId]" options={{ title: "" }} />
      <Stack.Screen name="repair/[asset]" options={{ title: "" }} />
      <Stack.Screen name="sell/[positionId]" options={{ title: "" }} />
    </Stack>
  );
}
