/** Help guide and FAQ for wallets (spec 2026-10-09 section 5). Plain language; shared by web and mobile. */
export const WALLET_HELP = [
  { id: "several-wallets", question: "Can I use different wallets for different chains?", answer: [
    "Yes. When you link a wallet, tick the chains it should serve, for example Base and BNB Chain in MetaMask and Ethereum in Trust Wallet. One approval links all ticked chains.",
    "Each chain has one wallet at a time. Bytesac picks the right wallet for every step and asks you to connect it if it is not connected." ] },
  { id: "move-chain", question: "How do I move a chain to another wallet?", answer: [
    "Profile → Wallets → Move to another wallet. You can move a chain only when you hold nothing on it through Bytesac and no operation is open. Native coins left over from gas top-ups do not block a move.",
    "Moving needs approval from both wallets: the new wallet, and the wallet that holds the chain now. This is a security step.",
    "Example: Base holds 100 AERO in MetaMask. Sell it, then go to Profile → Wallets → Move to another wallet, approve in Trust Wallet, then approve in MetaMask to confirm. New Base purchases go to Trust." ] },
  { id: "wrong-wallet", question: "What does \"Connect MetaMask to sign this step\" mean?", answer: [
    "The step uses a chain linked to a wallet that is not the one signing right now. Nothing was sent.",
    "On the web, Bytesac switches to the right connected wallet automatically. If that wallet is not connected, tap Connect wallet.",
    "On mobile, tap Connect wallet and pick the wallet named in the message, then tap the step again." ] },
  { id: "metamask-solana", question: "Why can't MetaMask sign Solana steps on my phone?", answer: [
    "MetaMask's mobile app shares only EVM chains with other apps today. For Solana, use a wallet that supports it, such as Phantom, Solflare or Trust Wallet." ] },
  { id: "import-phrase", question: "I imported my recovery phrase into another wallet. Is that enough?", answer: [
    "Check that the new wallet shows the same address as before. Wallets can derive different addresses from the same phrase, especially on Solana. Delete the old wallet only after the addresses match." ] },
  { id: "lost-wallet", question: "I lost my wallet or recovery phrase.", answer: [
    "Contact support: we can disable the address so nobody can sign in with it. We cannot move or recover your tokens: only your wallet can sign for them.",
    "Moving a chain to another wallet needs the old wallet to approve. Without it, contact support." ] },
  { id: "cannot-sign-chain", question: "\"Your wallet can't sign on Arbitrum\": what now?", answer: [
    "You can still invest: the tokens arrive at your address. To sell them later you need a wallet that signs on that chain, for example by linking that chain to another wallet." ] },
  { id: "per-step-approval", question: "Why do I approve every step?", answer: [
    "Bytesac never moves your funds on its own. Each step is one transaction you approve in your wallet. Signing in is a message, not a transaction, and moves no money." ] },
] as const;
