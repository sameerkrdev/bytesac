import type { Metadata } from "next";
import { ApplicationForm } from "@/components/managers/application-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Become a fund manager · Bytesac" };

export default function ApplyPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-space px-4 py-10">
      <Card className="w-full max-w-xl rounded-2xl border-border-dark bg-slate">
        <CardHeader className="space-y-2">
          <CardTitle className="font-display text-2xl font-semibold text-ivory">Become a fund manager</CardTitle>
          <p className="text-sm text-muted-foreground">Tell us about yourself. We&apos;ll confirm your email, then our team reviews your application.</p>
        </CardHeader>
        <CardContent><ApplicationForm /></CardContent>
      </Card>
    </main>
  );
}
