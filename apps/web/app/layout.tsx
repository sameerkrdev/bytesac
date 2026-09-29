import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-manrope", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Bytesac",
  description: "Manager-led, multi-chain investment baskets.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookies = (await headers()).get("cookie");
  return (
    <html lang="en" className={`dark ${manrope.variable} ${inter.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">
        <Providers cookies={cookies}>{children}</Providers>
      </body>
    </html>
  );
}
