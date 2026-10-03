import { Tabs } from "expo-router";
import { Bell, Compass, PieChart, User } from "lucide-react-native";
import { palette, semantic } from "@repo/design-tokens";
import { useUnreadCount } from "@/lib/use-unread";

export default function TabsLayout() {
  const unread = useUnreadCount();
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
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: ({ color, size }) => <Compass color={color} size={size} /> }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio", tabBarIcon: ({ color, size }) => <PieChart color={color} size={size} /> }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarIcon: ({ color, size }) => <Bell color={color} size={size} />,
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Notifications, ${unread} unread` : "Notifications",
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
