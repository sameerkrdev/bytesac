import { Compass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
  return (
    <section aria-labelledby="home-title" className="space-y-6">
      <h1 id="home-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Home</h1>
      <Card className="rounded-2xl border-border-dark bg-slate">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Compass aria-hidden className="size-10 text-mint" />
          <p className="text-base text-ivory">You&apos;re signed in. Basket discovery arrives soon.</p>
        </CardContent>
      </Card>
    </section>
  );
}
