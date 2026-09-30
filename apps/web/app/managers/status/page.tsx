import type { Metadata } from "next";
import { StatusView } from "@/components/managers/status-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Application status · Bytesac", referrer: "no-referrer" };

export default function StatusPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-space px-4 py-10">
      <Card className="w-full max-w-lg rounded-2xl border-border-dark bg-slate">
        <CardHeader><CardTitle className="font-display text-2xl font-semibold text-ivory">Application status</CardTitle></CardHeader>
        <CardContent><StatusView /></CardContent>
      </Card>
    </main>
  );
}
