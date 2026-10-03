import type { ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type RefreshControlProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function Screen({ children, scroll = true, refreshControl }: { children: ReactNode; scroll?: boolean; refreshControl?: ReactElement<RefreshControlProps> }) {
  return (
    <SafeAreaView className="flex-1 bg-space">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
        {scroll ? (
          <ScrollView
            refreshControl={refreshControl}
            contentContainerClassName="gap-5 px-4 py-6"
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            {children}
          </ScrollView>
        ) : <View className="flex-1 gap-5 px-4 py-6">{children}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
