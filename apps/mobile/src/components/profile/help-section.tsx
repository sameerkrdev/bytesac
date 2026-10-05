import { ChevronRight, Compass, KeyRound, type LucideIcon, Receipt } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";

type Topic = { key: string; title: string; hint: string; Icon: LucideIcon; sections: { heading: string; body: string }[] };

/* Wording follows the web pages /how-it-works, /self-custody and /fees (placeholder copy pending legal review). */
const TOPICS: Topic[] = [
  {
    key: "how", title: "How it works", hint: "Research, invest, monitor, decide", Icon: Compass,
    sections: [
      { heading: "Research", body: "Each basket page carries the thesis, target weights and bands, risks, fees, the organization and managers behind it, and every published version with what changed. AI search only turns your words into filters; queries are processed by Google Gemini." },
      { heading: "Invest", body: "Choose an amount at or above the basket minimum, funded in USDC on Solana. Before you sign anything you see the split per asset and network, the slippage, every fee and what you are authorizing. You need a verified email and phone to invest." },
      { heading: "Sign each step", body: "An investment is an operation made of steps. You sign each one in your own wallet, at that moment, against the plan you reviewed. EVM approvals are for the exact amount. If something stops halfway it is shown as it is, with the choice to continue or stop." },
      { heading: "Strategy, allocation, holdings", body: "A manager saying “35% BTC” never means your wallet holds 35% BTC. Bytesac shows the strategy target, your basket allocation and what your wallets verifiably hold side by side." },
      { heading: "Updates are your call", body: "Managers change a strategy by publishing a new version. You see the reason, what changed and your weights next to the new target, then create a plan or skip. Skipping never trades." },
    ],
  },
  {
    key: "custody", title: "Self-custody", hint: "What you sign and what Bytesac does", Icon: KeyRound,
    sections: [
      { heading: "Your wallets", body: "You connect wallets you already use; Bytesac does not create or store wallets for you. Assets stay in your own wallets." },
      { heading: "What a signature means", body: "Signing a sign-in message proves you control the wallet. It never authorizes a transaction. Neither does verifying your email, a manager publishing a new version, or any approval you gave for an earlier step." },
      { heading: "What Bytesac does", body: "On Solana Bytesac co-signs as the fee payer, and on EVM networks it can send a small amount of gas. That gas is charged back as a listed network fee, paid in the first step you sign." },
      { heading: "Your responsibility", body: "If a wallet is compromised, Bytesac cannot reverse a transaction you signed, and on-chain activity outside Bytesac is yours to manage. Tokenized real-world assets can carry issuer restrictions." },
    ],
  },
  {
    key: "fees", title: "Fees", hint: "Network, manager and platform fees", Icon: Receipt,
    sections: [
      { heading: "Network fee", body: "For the gas Bytesac fronts on your behalf. Shown as an amount before you sign." },
      { heading: "Manager fees", body: "Set by the organization that runs the basket. Entry and rebalance fees are collected; management and subscription fees are disclosed but not collected in this release." },
      { heading: "Platform fee", body: "Bytesac’s own rate, by operation. A basket or organization may have a different rate; the one that applies is shown on the basket and in the plan you sign." },
      { heading: "When fees are paid", body: "Up front, in USDC, in the first step of an operation — after you have seen every fee in the plan and before anything is traded. Fees are not refunded if the operation does not complete." },
    ],
  },
];

/** Short explainers in bottom sheets: how Bytesac works, self-custody, fees. */
export function HelpSection() {
  const { colors } = useTheme();
  const [open, setOpen] = useState<Topic | null>(null);
  return (
    <Card className="py-1">
      {TOPICS.map((t, i) => (
        <Pressable key={t.key} accessibilityRole="button" accessibilityLabel={t.title} accessibilityHint={t.hint} onPress={() => setOpen(t)}
          className={`min-h-14 flex-row items-center gap-3 py-3 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}>
          <View className="size-9 items-center justify-center rounded-tile bg-surface-muted"><t.Icon size={17} color={colors.inkMuted} /></View>
          <View className="flex-1 gap-0.5">
            <AppText className="font-medium">{t.title}</AppText>
            <AppText variant="micro" tone="faint">{t.hint}</AppText>
          </View>
          <ChevronRight size={16} color={colors.inkFaint} />
        </Pressable>
      ))}
      <Sheet visible={open !== null} onClose={() => setOpen(null)} title={open?.title ?? ""}>
        {open?.sections.map((s) => (
          <View key={s.heading} className="gap-1.5">
            <AppText variant="heading">{s.heading}</AppText>
            <AppText tone="muted">{s.body}</AppText>
          </View>
        ))}
        <AppText variant="micro" tone="faint">Placeholder copy — pending legal review.</AppText>
      </Sheet>
    </Card>
  );
}
