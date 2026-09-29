import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

export function newEvmWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address as string, sign: (message: string) => account.signMessage({ message }) as Promise<string> };
}

export function newSolanaWallet() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    address: bs58.encode(publicKey),
    sign: (message: string) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), secretKey)),
  };
}
