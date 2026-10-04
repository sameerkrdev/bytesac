"use client";
import type { MeResponse } from "@repo/validator";
import { useQueryClient } from "@tanstack/react-query";
import { ContactVerifier } from "@/components/contacts/contact-verifier";

export function ContactsSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  const emailContact = me.contacts.find((c) => c.type === "email");
  const phoneContact = me.contacts.find((c) => c.type === "phone");
  return (
    <section aria-labelledby="contacts-title" className="space-y-6 rounded-card border border-line bg-surface p-6">
      <div>
        <h2 id="contacts-title" className="type-heading text-ink">Contacts</h2>
        <p className="text-sm text-ink-muted">Required later before investing.</p>
      </div>
      <ContactVerifier type="email" existing={emailContact} key={`email:${emailContact?.id}:${emailContact?.status}`} onVerified={refresh} onChanged={refresh} />
      <ContactVerifier type="phone" existing={phoneContact} key={`phone:${phoneContact?.id}:${phoneContact?.status}`} onVerified={refresh} onChanged={refresh} />
    </section>
  );
}
