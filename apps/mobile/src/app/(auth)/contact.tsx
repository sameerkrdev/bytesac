import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { Mail, Phone } from "lucide-react-native";
import { View } from "react-native";
import { BrandedSplash } from "@/components/brand/splash";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

/** After a first sign-in: verify email and phone (needed before investing), or skip for now. */
export default function ContactScreen() {
  const { status } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  if (status === "loading") return <BrandedSplash />;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  const email = me?.contacts.find((c) => c.type === "email");
  const phone = me?.contacts.find((c) => c.type === "phone");
  const done = [email, phone].filter((c) => c?.status === "verified").length;
  return (
    <Screen edges={["left", "right", "bottom"]} backdrop={<Sky height={340} />}>
      <View className="gap-2 pt-20">
        <AppText variant="eyebrow" tone="muted">{`Step 2 of 2 · ${done} of 2 verified`}</AppText>
        <AppText variant="display" accessibilityRole="header">Add your contact details</AppText>
        <AppText tone="muted">We use these for important account and investment notices. Required later before investing.</AppText>
      </View>
      <Card className="gap-6">
        <View className="flex-row items-center gap-2"><Mail size={16} color={colors.inkMuted} /><AppText variant="label" tone="muted">Email</AppText></View>
        <ContactVerifier type="email" existing={email} key={`email:${email?.id}:${email?.status}`} onChanged={refresh} />
        <View className="h-px bg-line" />
        <View className="flex-row items-center gap-2"><Phone size={16} color={colors.inkMuted} /><AppText variant="label" tone="muted">Phone</AppText></View>
        <ContactVerifier type="phone" existing={phone} key={`phone:${phone?.id}:${phone?.status}`} onChanged={refresh} />
      </Card>
      {done === 2
        ? <Button size="lg" onPress={() => router.replace("/(app)/(tabs)/home")}>Continue</Button>
        : <Button variant="ghost" onPress={() => router.replace("/(app)/(tabs)/home")}>Skip for now</Button>}
    </Screen>
  );
}
