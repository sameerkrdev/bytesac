import { Stack } from "expo-router";
import { palette } from "@repo/design-tokens";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.space } }} />;
}
