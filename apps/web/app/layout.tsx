import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Providers } from "@/components/providers";
import { SurfaceProvider } from "@/components/layout/surface";
import { SURFACE_HEADER } from "@/lib/surface";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Bytesac — Invest in strategies, not individual trades", template: "%s · Bytesac" },
  description: "Discover and research curated investment baskets from verified organizations. Invest from your own wallet and decide whether to follow every strategy update.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8FB" },
    { media: "(prefers-color-scheme: dark)", color: "#070D18" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const h = await headers();
  const cookieHeader = h.get("cookie");
  // A forced theme is rendered on the server so there is no flash; `system` leaves it to prefers-color-scheme.
  const choice = (await cookies()).get("bx_theme")?.value;
  const theme = choice === "light" || choice === "dark" ? choice : undefined;
  return (
    <html lang="en" data-theme={theme} className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="bg-canvas font-sans text-ink antialiased">
        <SurfaceProvider value={h.get(SURFACE_HEADER) === "marketing" ? "marketing" : "app"}>
          <Providers cookies={cookieHeader}>{children}</Providers>
        </SurfaceProvider>
      </body>
    </html>
  );
}
