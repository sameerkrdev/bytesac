/**
 * Wallet apps (Phantom, Solflare, WalletConnect deep links) return to the app via
 * `bytesac://?data=...&nonce=...` (or a `wc:` URI). These are consumed by the wallet SDKs, not by
 * routing, so they must not navigate: returning null keeps the current route (SDK 57 docs).
 */
const WALLET_PARAMS = ["data", "nonce", "errorCode", "errorMessage", "wc", "phantom_encryption_public_key", "solflare_encryption_public_key"];

export function isWalletReturnUrl(path: string): boolean {
  if (/^wc:/i.test(path)) return true;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^?#]*)(?:\?([^#]*))?/i.exec(path);
  if (!m) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(path)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "bytesac") return false;
  const rest = m[1] ?? "";
  if (rest !== "" && rest !== "/") return false;
  const keys = (m[2] ?? "").split("&").map((kv) => decodeSafe(kv.split("=")[0] ?? ""));
  return keys.some((k) => WALLET_PARAMS.includes(k) || k.startsWith("wc"));
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return isWalletReturnUrl(path) ? null : path;
  } catch {
    return path;
  }
}
