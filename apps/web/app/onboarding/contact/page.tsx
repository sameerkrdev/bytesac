import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { ContactVerifier } from "@/components/contacts/contact-verifier";
import { buttonVariants } from "@/components/ui/button";
import { getServerMe } from "@/lib/server-me";

export default async function ContactOnboardingPage() {
  const me = await getServerMe();
  if (!me) redirect("/sign-in?reason=expired");
  const email = me.contacts.find((c) => c.type === "email");
  const phone = me.contacts.find((c) => c.type === "phone");
  return (
    <AuthFrame title={<>You&apos;re signed in.<span className="block text-ink-muted">One more step before investing.</span></>}>
      <div className="space-y-8 rounded-shell border border-line bg-surface p-6 shadow-float sm:p-8">
        <ol aria-label="Account setup" className="flex items-center gap-4 text-sm">
          <li className="flex items-center gap-2 text-ink-faint"><span aria-hidden className="grid size-6 place-items-center rounded-full bg-primary text-[0.6875rem] text-primary-ink">✓</span>Wallet</li>
          <li aria-hidden className="h-px w-8 bg-line-strong" />
          <li className="flex items-center gap-2 text-ink"><span aria-hidden className="grid size-6 place-items-center rounded-full border border-primary font-mono text-[0.6875rem]">2</span>Contact details</li>
        </ol>
        <div className="space-y-3">
          <h1 className="type-title text-ink">Add your contact details</h1>
          <p className="text-ink-muted">We use these for important account and investment notices. Required later before investing.</p>
        </div>
        <ContactVerifier type="email" existing={email} key={`email:${email?.id}:${email?.status}`} />
        <ContactVerifier type="phone" existing={phone} key={`phone:${phone?.id}:${phone?.status}`} />
        <Link href="/home" className={buttonVariants({ variant: "ghost", className: "w-full" })}>Skip for now</Link>
      </div>
    </AuthFrame>
  );
}
