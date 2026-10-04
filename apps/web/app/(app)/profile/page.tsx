"use client";
import { BitcoinLink } from "@/components/profile/bitcoin-link";
import { ContactsSection } from "@/components/profile/contacts-section";
import { EligibilitySection } from "@/components/profile/eligibility-section";
import { ManagerProfileEditor } from "@/components/profile/manager-profile-editor";
import { NotificationsSection } from "@/components/profile/notifications-section";
import { SessionsSection } from "@/components/profile/sessions-section";
import { WalletSection } from "@/components/profile/wallet-section";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { useMe } from "@/components/me-context";
import { PageLayout } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";

const INDEX = [
  ["wallets", "Wallets"], ["contacts", "Contact details"], ["eligibility", "Eligibility"], ["manager-profile", "Manager profile"],
  ["notifications", "Notifications"], ["sessions", "Sessions & security"], ["appearance", "Appearance"],
] as const;

/** Account hub. Section anchors are stable: the mobile app links to /profile and its sections. */
export default function ProfilePage() {
  const { data: me } = useMe();
  if (!me) return <LoadingState />;
  return (
    <PageLayout title="Profile" eyebrow="Account" description="Your wallets, contact details, eligibility and how Bytesac reaches you.">
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Profile sections" className="hidden lg:block">
          <ul className="sticky top-28 space-y-0.5 border-l border-line">
            {INDEX.map(([id, label]) => <li key={id}><a href={`#${id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-ink-muted hover:border-ink hover:text-ink">{label}</a></li>)}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6 [&>div]:scroll-mt-28">
          <div id="wallets" className="space-y-6"><WalletSection me={me} /><BitcoinLink me={me} /></div>
          <div id="contacts"><ContactsSection me={me} /></div>
          <div id="eligibility"><EligibilitySection /></div>
          <div id="manager-profile"><ManagerProfileEditor /></div>
          <div id="notifications"><NotificationsSection /></div>
          <div id="sessions"><SessionsSection /></div>
          <div id="appearance">
            <section aria-labelledby="appearance-title" className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-6">
              <div><h2 id="appearance-title" className="type-heading text-ink">Appearance</h2><p className="text-sm text-ink-muted">Light, dark, or match your device.</p></div>
              <ThemeSwitch />
            </section>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
