import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function ContactScreen() {
  const { status } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  if (status === "loading") return null;
  if (status === "signedOut") return <Redirect href="/(auth)/sign-in" />;
  const email = me?.contacts.find((c) => c.type === "email");
  const phone = me?.contacts.find((c) => c.type === "phone");
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Add your contact details</AppText>
      <AppText tone="muted">We use these for important account and investment notices. Required later before investing.</AppText>
      <Card className="gap-6">
        <ContactVerifier type="email" existing={email} key={`email:${email?.id}:${email?.status}`} onChanged={refresh} />
        <ContactVerifier type="phone" existing={phone} key={`phone:${phone?.id}:${phone?.status}`} onChanged={refresh} />
      </Card>
      <Button variant="ghost" onPress={() => router.replace("/(app)/home")}>Skip for now</Button>
    </Screen>
  );
}
