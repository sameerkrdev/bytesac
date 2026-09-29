import { redirect } from "next/navigation";
import Link from "next/link";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerMe } from "@/lib/server-me";

export default async function ContactOnboardingPage() {
  const me = await getServerMe();
  if (!me) redirect("/sign-in?reason=expired");
  const email = me.contacts.find((c) => c.type === "email");
  const phone = me.contacts.find((c) => c.type === "phone");
  return (
    <main className="grid min-h-screen place-items-center bg-space px-4 py-10">
      <Card className="w-full max-w-lg rounded-2xl border-border-dark bg-slate">
        <CardHeader className="space-y-2">
          <CardTitle className="font-display text-2xl font-semibold text-ivory">Add your contact details</CardTitle>
          <p className="text-sm text-muted-foreground">We use these for important account and investment notices. Required later before investing.</p>
        </CardHeader>
        <CardContent className="space-y-8">
          <ContactVerifier type="email" existing={email} key={`email:${email?.id}:${email?.status}`} />
          <ContactVerifier type="phone" existing={phone} key={`phone:${phone?.id}:${phone?.status}`} />
          <Link href="/home" className="inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-ivory hover:bg-space/60">
            Skip for now
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
