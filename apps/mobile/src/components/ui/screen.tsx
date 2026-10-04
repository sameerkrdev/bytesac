import type { ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText } from "./app-text";

/**
 * A screen: canvas background, safe areas, keyboard avoidance, an optional large title block (eyebrow, title,
 * description) and an optional `backdrop` (e.g. the sky) that scrolls with the content. Tab screens pass
 * `tabBarInset` so content clears the floating tab bar.
 */
export function Screen({ children, scroll = true, refreshControl, eyebrow, title, description, backdrop, tabBarInset = false, edges, footer }: {
  children: ReactNode; scroll?: boolean; refreshControl?: ReactElement<RefreshControlProps>; eyebrow?: string; title?: string; description?: string;
  backdrop?: ReactNode; tabBarInset?: boolean; edges?: ("top" | "bottom" | "left" | "right")[]; footer?: ReactNode;
}) {
  const head = title ? (
    <View className="gap-2 pb-1">
      {eyebrow ? <AppText variant="eyebrow" tone="faint">{eyebrow}</AppText> : null}
      <AppText variant="display" accessibilityRole="header">{title}</AppText>
      {description ? <AppText tone="muted">{description}</AppText> : null}
    </View>
  ) : null;
  const pad = `gap-6 px-5 pt-4 ${tabBarInset ? "pb-32" : "pb-10"}`;
  return (
    <SafeAreaView edges={edges ?? ["top", "left", "right"]} className="flex-1 bg-canvas">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
        {scroll ? (
          <ScrollView refreshControl={refreshControl} contentContainerClassName={pad} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}>
            {backdrop}
            {head}
            {children}
          </ScrollView>
        ) : <View className={`flex-1 ${pad}`}>{backdrop}{head}{children}</View>}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A sticky bottom action area (invest, sign, review) above the home indicator. */
export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={["bottom"]} className="border-t border-line bg-canvas px-5 pt-3 pb-2">
      <View className="gap-2">{children}</View>
    </SafeAreaView>
  );
}

/** A titled section inside a screen. */
export function Section({ title, eyebrow, action, children }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View className="gap-3">
      {(title || action) ? (
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            {eyebrow ? <AppText variant="eyebrow" tone="faint">{eyebrow}</AppText> : null}
            {title ? <AppText variant="heading" accessibilityRole="header">{title}</AppText> : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}
