import { Monitor, Moon, Sun } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { type ThemeChoice, useTheme } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Light, dark or follow the device. Stored on this device only. */
export function AppearanceSection() {
  const { choice, setChoice, colors } = useTheme();
  return (
    <Card className="gap-4">
      <View className="gap-1">
        <AppText variant="heading" accessibilityRole="header">Appearance</AppText>
        <AppText variant="label" tone="muted">Saved on this device.</AppText>
      </View>
      <View accessibilityRole="radiogroup" className="flex-row gap-2">
        {OPTIONS.map(({ value, label, Icon }) => {
          const on = choice === value;
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => setChoice(value)}
              className={`min-h-20 flex-1 items-center justify-center gap-2 rounded-tile border ${on ? "border-primary bg-primary" : "border-line bg-surface-muted"}`}>
              <Icon size={18} color={on ? colors.primaryInk : colors.inkMuted} />
              <AppText variant="label" tone={on ? "primaryInk" : "ink"}>{label}</AppText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
