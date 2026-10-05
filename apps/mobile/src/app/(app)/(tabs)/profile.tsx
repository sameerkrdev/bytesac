import { shortAddress } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react-native";
import { View } from "react-native";
import { AppearanceSection } from "@/components/profile/appearance-section";
import { ContactsSection } from "@/components/profile/contacts-section";
import { EligibilitySection } from "@/components/profile/eligibility-section";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { BitcoinSection, ManageOnWebCard } from "@/components/profile/web-sections";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <View className="gap-3">
    <AppText variant="eyebrow" tone="faint" accessibilityRole="header">{title}</AppText>
    {children}
  </View>
);

/** Your account hub: wallet and contacts, eligibility, notifications and appearance, sessions, then log out. */
export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const { data: me, isError, refetch } = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const primary = me?.wallet.addresses.find((a) => a.status === "active");
  const verified = me ? ["email", "phone"].every((t) => me.contacts.some((c) => c.type === t && c.status === "verified")) : false;
  return (
    <Screen tabBarInset title="Profile">
      {isError && <Button variant="secondary" onPress={() => void refetch()}>Retry loading profile</Button>}
      {me && (
        <>
          <View className="flex-row items-center gap-4 rounded-card border border-line bg-surface p-5">
            <View className="size-14 items-center justify-center rounded-pill bg-primary">
              <AppText variant="heading" tone="primaryInk">{(me.wallet.walletProvider ?? "W").slice(0, 1).toUpperCase()}</AppText>
            </View>
            <View className="flex-1 gap-1">
              <AppText className="font-medium" numberOfLines={1}>{primary ? shortAddress(primary.address) : "No active address"}</AppText>
              <AppText variant="label" tone="muted" numberOfLines={1}>{`${me.wallet.walletProvider ?? "Wallet"} · ${me.wallet.addresses.length} ${me.wallet.addresses.length === 1 ? "network" : "networks"}`}</AppText>
              <View className="flex-row pt-1"><StatusBadge tone={verified ? "success" : "warning"} label={verified ? "Contacts verified" : "Contacts needed"} /></View>
            </View>
          </View>
          <ManageOnWebCard me={me} />
          <Group title="Account">
            <WalletSection me={me} />
            <BitcoinSection me={me} />
            <ContactsSection me={me} />
            <EligibilitySection />
          </Group>
          <Group title="Preferences">
            <NotificationsSection />
            <AppearanceSection />
          </Group>
          <Group title="Security">
            <SessionsSection />
          </Group>
        </>
      )}
      <Button variant="ghost" icon={<LogOut size={16} color={colors.ink} />} onPress={() => void signOut({ remote: true })}>Log out</Button>
    </Screen>
  );
}
