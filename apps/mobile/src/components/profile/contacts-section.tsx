import type { MeResponse } from "@repo/validator";
import { useQueryClient } from "@tanstack/react-query";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";

export function ContactsSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  const email = me.contacts.find((c) => c.type === "email");
  const phone = me.contacts.find((c) => c.type === "phone");
  return (
    <Card className="gap-5">
      <AppText variant="heading" accessibilityRole="header">Contacts</AppText>
      <AppText tone="muted">Required later before investing.</AppText>
      <ContactVerifier type="email" existing={email} key={`email:${email?.id}:${email?.status}`} onVerified={refresh} onChanged={refresh} />
      <ContactVerifier type="phone" existing={phone} key={`phone:${phone?.id}:${phone?.status}`} onVerified={refresh} onChanged={refresh} />
    </Card>
  );
}
