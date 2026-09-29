import { Logo } from "@/components/brand/logo";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";

export default function Index() {
  return (
    <Screen>
      <Logo />
      <AppText variant="h1">Bytesac</AppText>
    </Screen>
  );
}
