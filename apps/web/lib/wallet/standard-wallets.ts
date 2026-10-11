/** A Wallet Standard wallet as registered in the page. `accounts` is the wallet's own live list, so the object is kept, not copied. */
export type StandardWallet = { name: string; features: Record<string, unknown>; accounts: readonly { address: string }[] };

/** Wallet Standard discovery without `@wallet-standard/app`: the register protocol of the wallet-standard repo (core/base register.ts). Shared by the dev lab and the signer. */
export function standardWallets(timeoutMs = 300): Promise<StandardWallet[]> {
  return new Promise((resolve) => {
    const found: StandardWallet[] = [];
    const api = { register: (...wallets: StandardWallet[]) => { found.push(...wallets); return () => {}; } };
    const onRegister = (event: Event) => (event as CustomEvent<(a: typeof api) => void>).detail(api);
    window.addEventListener("wallet-standard:register-wallet", onRegister);
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
    setTimeout(() => {
      window.removeEventListener("wallet-standard:register-wallet", onRegister);
      resolve(found);
    }, timeoutMs);
  });
}
