import { notFound } from "next/navigation";
import { WalletLab } from "@/components/dev/wallet-lab";

export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NEXT_PUBLIC_WALLET_LAB !== "1") notFound();
  return <WalletLab />;
}
