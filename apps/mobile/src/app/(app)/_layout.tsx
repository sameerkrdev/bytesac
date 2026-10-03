import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack } from "expo-router";
import { palette } from "@repo/design-tokens";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout() {
  const { status } = useAuth();
  // Validates the stored token on cold start; a SESSION_EXPIRED/USER_NOT_ACTIVE error triggers the expiry sign-out.
  useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: status === "signedIn" });
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.slate },
        headerTintColor: palette.ivory,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: palette.space },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="basket/[slug]" options={{ title: "Basket" }} />
      <Stack.Screen name="invest/[slug]" options={{ title: "Invest" }} />
      <Stack.Screen name="operation/[id]" options={{ title: "Operation" }} />
      <Stack.Screen name="rebalance/[positionId]" options={{ title: "Rebalance" }} />
      <Stack.Screen name="repair/[asset]" options={{ title: "Repair" }} />
      <Stack.Screen name="sell/[positionId]" options={{ title: "Sell" }} />
    </Stack>
  );
}
