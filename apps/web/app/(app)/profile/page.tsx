"use client";
import { BitcoinLink } from "@/components/profile/bitcoin-link";
import { ContactsSection } from "@/components/profile/contacts-section";
import { EligibilitySection } from "@/components/profile/eligibility-section";
import { ManagerProfileEditor } from "@/components/profile/manager-profile-editor";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { useMe } from "@/components/me-context";
import { PageLayout } from "@/components/layout/page-layout";

export default function ProfilePage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <PageLayout title="Profile">
      <WalletSection me={me} />
      <BitcoinLink me={me} />
      <ContactsSection me={me} />
      <EligibilitySection />
      <ManagerProfileEditor />
      <NotificationsSection />
      <SessionsSection />
    </PageLayout>
  );
}
