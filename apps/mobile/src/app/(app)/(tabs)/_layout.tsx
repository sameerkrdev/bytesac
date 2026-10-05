import { Tabs } from "expo-router";
import { Bell, Compass, House, PieChart, UserRound } from "lucide-react-native";
import { GlassTabBar } from "@/components/nav/glass-tab-bar";
import { useTheme } from "@/lib/theme";
import { useUnreadCount } from "@/lib/use-unread";

/** Five places investors go most, like the web's phone tab bar: Home, Discover, Portfolio, Alerts, Profile. */
export default function TabsLayout() {
  const unread = useUnreadCount();
  const { colors } = useTheme();
  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}>
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ color, size }) => <House color={color} size={size} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: ({ color, size }) => <Compass color={color} size={size} strokeWidth={1.8} /> }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portfolio", tabBarIcon: ({ color, size }) => <PieChart color={color} size={size} strokeWidth={1.8} /> }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, size }) => <Bell color={color} size={size} strokeWidth={1.8} />,
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Alerts, ${unread} unread` : "Alerts",
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} strokeWidth={1.8} /> }} />
    </Tabs>
  );
}
