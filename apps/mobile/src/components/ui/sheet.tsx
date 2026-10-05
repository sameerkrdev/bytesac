import { X } from "lucide-react-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VariableContextProvider } from "nativewind";
import { themeVars, useTheme } from "@/lib/theme";
import { AppText } from "./app-text";

/**
 * A bottom sheet: slides up over a dimmed backdrop (tap it, the close button or the system back to dismiss), with a
 * grab handle, a title and scrolling content. Built on React Native's Modal, so it needs no extra native module.
 */
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode }) {
  const { colors, scheme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* A modal renders outside the app root on web, so it re-provides the theme variables. */}
      <VariableContextProvider value={themeVars(scheme)}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="flex-1" style={{ backgroundColor: colors.overlay }} />
        <View className="max-h-[88%] rounded-t-shell border-t border-line bg-canvas">
          <View className="items-center pt-2.5"><View className="h-1 w-10 rounded-pill bg-line-strong" /></View>
          <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
            <AppText variant="title" accessibilityRole="header">{title}</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} className="size-11 items-center justify-center rounded-pill bg-surface-muted">
              <X size={18} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-6 pt-2">{children}</ScrollView>
          {footer ? <SafeAreaView edges={["bottom"]}><View className="gap-2 border-t border-line px-5 pb-2 pt-3">{footer}</View></SafeAreaView> : <SafeAreaView edges={["bottom"]} />}
        </View>
      </KeyboardAvoidingView>
      </VariableContextProvider>
    </Modal>
  );
}
