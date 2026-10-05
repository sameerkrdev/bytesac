import { View } from "react-native";
import { AppText } from "./app-text";

/** A round initial for people and organizations without a logo. */
export function Monogram({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View className="items-center justify-center rounded-pill bg-surface-muted" style={{ width: size, height: size }}>
      <AppText className="font-medium">{name.trim().slice(0, 1).toUpperCase()}</AppText>
    </View>
  );
}
