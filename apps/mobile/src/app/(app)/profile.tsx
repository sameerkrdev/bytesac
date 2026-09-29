import { useQuery } from "@tanstack/react-query";
import { ContactsSection } from "@/components/profile/contacts-section";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
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
          <WalletSection me={me} />
          <ContactsSection me={me} />
          <NotificationsSection />
          <SessionsSection />
        </>
      )}
      <Button variant="ghost" onPress={() => void signOut({ remote: true })}>Log out</Button>
    </Screen>
  );
}
