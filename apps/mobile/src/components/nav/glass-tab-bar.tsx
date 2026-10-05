import * as Haptics from "expo-haptics";
import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "@/components/ui/app-text";
import { Glass } from "@/components/ui/glass";
import { useTheme } from "@/lib/theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * The floating glass tab bar, like the web's phone tab bar: rounded, inset from the edges, an ink pill behind the
 * active icon, badges from `tabBarBadge`, accessible names from `tabBarAccessibilityLabel`.
 */
export function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }}>
      <Glass className="flex-row rounded-pill px-1.5 py-1.5" style={{ shadowColor: "#0F1E3A", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 }}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const focused = state.index === index;
          const label = typeof options.title === "string" ? options.title : route.name;
          const badge = options.tabBarBadge;
          const color = focused ? colors.primaryInk : colors.inkMuted;
          return (
            <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label} testID={`tab-${route.name}`}
              onPress={() => {
                const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) { void Haptics.selectionAsync().catch(() => undefined); navigation.navigate(route.name, route.params); }
              }}
              className="min-h-14 flex-1 items-center justify-center gap-0.5 rounded-pill"
              style={focused ? { backgroundColor: colors.primary } : undefined}>
              <View>
                {options.tabBarIcon?.({ focused, color, size: 22 })}
                {badge !== undefined ? (
                  <View className="absolute -right-2.5 -top-1.5 min-w-4 items-center rounded-pill bg-accent px-1">
                    <AppText variant="micro" tone="primaryInk" className="font-semibold" style={{ color: "#FFFFFF" }}>{String(badge)}</AppText>
                  </View>
                ) : null}
              </View>
              <AppText variant="micro" style={{ color }} className={focused ? "font-medium" : ""}>{label}</AppText>
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}
