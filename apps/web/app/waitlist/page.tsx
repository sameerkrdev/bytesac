import { PublicShell } from "@/components/layout/app-shell";
import { WaitlistLanding } from "@/components/marketing/waitlist-landing";

export const metadata = {
  title: "Join the waitlist — Bytesac",
  description: "Manager-led, multi-chain investment baskets. Self-custody by design.",
};

export default function WaitlistPage() {
  return (
    <PublicShell bare>
      <WaitlistLanding />
    </PublicShell>
  );
}
