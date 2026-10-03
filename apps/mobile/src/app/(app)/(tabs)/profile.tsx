import { useQuery } from "@tanstack/react-query";
import { ContactsSection } from "@/components/profile/contacts-section";
import { EligibilitySection } from "@/components/profile/eligibility-section";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { BitcoinSection, ManageOnWebCard } from "@/components/profile/web-sections";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { data: me, isError, refetch } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  return (
    <Screen>
      <AppText variant="h1" accessibilityRole="header">Profile</AppText>
      {isError && <Button variant="secondary" onPress={() => void refetch()}>Retry loading profile</Button>}
      {me && (
        <>
          <ManageOnWebCard me={me} />
          <WalletSection me={me} />
          <BitcoinSection me={me} />
          <ContactsSection me={me} />
          <EligibilitySection />
          <NotificationsSection />
          <SessionsSection />
        </>
      )}
      <Button variant="ghost" onPress={() => void signOut({ remote: true })}>Log out</Button>
    </Screen>
  );
}
