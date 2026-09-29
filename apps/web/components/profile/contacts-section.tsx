"use client";
import type { MeResponse } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ContactVerifier } from "@/components/contacts/contact-verifier";

export function ContactsSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["me"] });
  return (
    <section aria-labelledby="contacts-title" className="space-y-6 rounded-2xl border border-border-dark bg-slate p-6">
      <div>
        <h2 id="contacts-title" className="font-display text-xl font-semibold text-ivory">Contacts</h2>
        <p className="text-sm text-muted-foreground">Required later before investing.</p>
      </div>
      <ContactVerifier type="email" existing={me.contacts.find((c) => c.type === "email")} onVerified={refresh} />
      <ContactVerifier type="phone" existing={me.contacts.find((c) => c.type === "phone")} onVerified={refresh} />
    </section>
  );
}
