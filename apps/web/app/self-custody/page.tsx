import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/app-shell";
import { Chapter, PageHero } from "@/components/marketing/page-hero";
import { ClosingCta } from "@/components/marketing/sections";
import { Reveal } from "@/components/motion/reveal";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { ChainBadge } from "@/components/visual/chain-badge";

export const metadata: Metadata = { title: "Your wallet, your signature", description: "What you sign, what Bytesac signs, and what Bytesac never holds." };

const YOU = [
  "Every transaction that moves your assets — each step of an investment, rebalance, repair or sale.",
  "EVM token approvals, for the exact amount of that step only.",
  "The network fee step, which pays Bytesac back for gas it fronted.",
  "Sign-in messages that prove you control your wallet (these never authorize spending).",
];
const BYTESAC = [
  "Co-signs Solana steps as the fee payer — only when the transaction is byte-for-byte the one you reviewed.",
  "Sends a small amount of gas to your EVM address when a step needs it.",
];
const NEVER = [
  "Hold your private keys, seed phrase or funds.",
  "Hold assets in transit — trades settle into your own wallets.",
  "Keep standing allowances, session keys or delegated spending rights.",
  "Trade because a manager published a new version. You decide.",
];

function List({ items, icon }: { items: string[]; icon: "check" | "minus" }) {
  return (
    <ul className="space-y-3">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-ink-muted">
          {icon === "check" ? <Check aria-hidden className="mt-1 size-4 shrink-0 text-ink" /> : <Minus aria-hidden className="mt-1 size-4 shrink-0 text-ink-faint" />}
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SelfCustodyPage() {
  return (
    <PublicShell bare>
      <SmoothScroll />
      <PageHero eyebrow="Self-custody" object="glass-wallet" lines={["Your wallet.", <span key="b" className="text-ink-muted">Your signature.</span>]}
        lede="Bytesac is designed so that the assets in your baskets stay in wallets you control, and nothing moves until you sign it." />

      <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-10">
        <Reveal className="grid gap-4 py-10 md:grid-cols-3">
          <section aria-labelledby="you-sign" className="rounded-card border border-line bg-surface p-7">
            <h2 id="you-sign" className="type-eyebrow text-ink-faint">You sign</h2>
            <div className="mt-6"><List items={YOU} icon="check" /></div>
          </section>
          <section aria-labelledby="we-sign" className="rounded-card border border-line bg-surface p-7">
            <h2 id="we-sign" className="type-eyebrow text-ink-faint">Bytesac signs</h2>
            <div className="mt-6"><List items={BYTESAC} icon="check" /></div>
            <p className="mt-6 text-sm text-ink-faint">The gas Bytesac fronts is charged back as a listed network fee, paid in the first step you sign.</p>
          </section>
          <section aria-labelledby="never" data-theme="dark" className="rounded-card bg-canvas p-7 text-ink">
            <h2 id="never" className="type-eyebrow text-ink-faint">Bytesac never</h2>
            <div className="mt-6"><List items={NEVER} icon="minus" /></div>
          </section>
        </Reveal>

        <Chapter n="01" title="Where your assets live" aside={
          <div className="flex flex-wrap gap-2">{["solana", "ethereum", "base", "bnb", "arbitrum", "bitcoin"].map((c) => <ChainBadge key={c} chain={c} />)}</div>
        }>
          <p>Your <strong>Solana wallet</strong> is where investments are funded (USDC) and where Solana assets settle. Your linked <strong>EVM address</strong> holds assets on Ethereum, Base, BNB Chain and Arbitrum. A linked <strong>Bitcoin address</strong> receives native BTC (linking is done on the web).</p>
          <p>You connect wallets you already use; Bytesac does not create or store wallets for you. In this release you can link one address per chain family.</p>
        </Chapter>

        <Chapter n="02" title="Signing in is not spending">
          <p>Signing a sign-in message proves you control the wallet. It never authorizes a transaction. Neither does verifying your email, a manager publishing a new version, or any approval you gave for an earlier step.</p>
        </Chapter>

        <Chapter n="03" title="What “non-custodial” does and doesn’t promise">
          <p>Self-custody means your keys and your assets stay with you. It also means you are responsible for your wallet: if a wallet is compromised, Bytesac cannot reverse a transaction you signed, and on-chain activity outside Bytesac is yours to manage. The exact flow depends on the chain and asset; tokenized real-world assets can carry issuer restrictions.</p>
          <p className="text-sm text-ink-faint">[Placeholder copy — pending legal review.]</p>
        </Chapter>
      </div>
      <ClosingCta />
    </PublicShell>
  );
}
