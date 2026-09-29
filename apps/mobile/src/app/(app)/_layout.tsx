import { useQuery } from "@tanstack/react-query";
import { Redirect, Tabs } from "expo-router";
import { Home, User } from "lucide-react-native";
import { palette, semantic } from "@repo/design-tokens";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function AppLayout() {
  const { status } = useAuth();
  // Validates the stored token on cold start; a SESSION_EXPIRED/USER_NOT_ACTIVE error triggers the expiry sign-out.
  useQuery({ queryKey: ["me"], queryFn: () => api.me(), enabled: status === "signedIn" });
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: palette.slate, borderTopColor: semantic.borderDark, minHeight: 56 },
        tabBarActiveTintColor: palette.mint,
        tabBarInactiveTintColor: palette.stone,
        sceneStyle: { backgroundColor: palette.space },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
