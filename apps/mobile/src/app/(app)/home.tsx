import { Compass } from "lucide-react-native";
import { palette } from "@repo/design-tokens";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";

export default function HomeScreen() {
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Home</AppText>
      <Card className="items-center gap-3 py-12">
        <Compass color={palette.mint} size={40} />
        <AppText variant="bodyLarge" className="text-center">{"You're signed in. Basket discovery arrives soon."}</AppText>
      </Card>
    </Screen>
  );
}
