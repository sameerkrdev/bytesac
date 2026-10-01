"use client";
import { BitcoinLink } from "@/components/profile/bitcoin-link";
import { ContactsSection } from "@/components/profile/contacts-section";
import { ManagerProfileEditor } from "@/components/profile/manager-profile-editor";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { useMe } from "@/components/me-context";

export default function ProfilePage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">Profile</h1>
      <WalletSection me={me} />
      <BitcoinLink me={me} />
      <ContactsSection me={me} />
      <ManagerProfileEditor />
      <NotificationsSection />
      <SessionsSection />
    </div>
  );
}
