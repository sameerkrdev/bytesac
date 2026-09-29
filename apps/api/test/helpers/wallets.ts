import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

export function newEvmWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  return { address: account.address as string, sign: (message: string) => account.signMessage({ message }) as Promise<string> };
}

export function newSolanaWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    address: bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url")),
    sign: (message: string) => bs58.encode(sign(null, Buffer.from(message), privateKey)),
  };
}
