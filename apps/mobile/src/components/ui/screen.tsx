import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView className="flex-1 bg-space">
      {scroll ? <ScrollView contentContainerClassName="gap-5 px-4 py-6" keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View className="flex-1 gap-5 px-4 py-6">{children}</View>}
    </SafeAreaView>
  );
}
