import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { CHAINS, familyOf, type Chain } from "@repo/validator";

export const SIGN_IN_STATEMENT = "Sign in to Bytesac. This does not authorize any transaction or spending.";

/** Bitcoin is link-only: it can never sign you in. */
const LINK_STATEMENT = "Link this Bitcoin address to your Bytesac account. This does not sign you in or authorize any transaction or spending.";

export interface SignInMessageInput {
  chain: Chain;
  address: string;
  domain: string;
  uri: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

export function buildSignInMessage(i: SignInMessageInput): { message: string; chainId: string } {
  const info = CHAINS[i.chain];
  if (familyOf(i.chain) === "evm") {
    const chainId = info.evmChainId as number;
    const message = createSiweMessage({
      domain: i.domain,
      address: getAddress(i.address),
      statement: SIGN_IN_STATEMENT,
      uri: i.uri,
      version: "1",
      chainId,
      nonce: i.nonce,
      issuedAt: i.issuedAt,
      expirationTime: i.expiresAt,
    });
    return { message, chainId: String(chainId) };
  }
  if (familyOf(i.chain) === "bitcoin") {
    const message = [
      `${i.domain} wants you to link your Bitcoin account:`,
      i.address,
      "",
      LINK_STATEMENT,
      "",
      `URI: ${i.uri}`,
      "Version: 1",
      "Chain ID: mainnet",
      `Nonce: ${i.nonce}`,
      `Issued At: ${i.issuedAt.toISOString()}`,
      `Expiration Time: ${i.expiresAt.toISOString()}`,
    ].join("\n");
    return { message, chainId: "mainnet" };
  }
  const chainId = info.solanaCluster as string;
  const message = [
    `${i.domain} wants you to sign in with your Solana account:`,
    i.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${i.uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${i.nonce}`,
    `Issued At: ${i.issuedAt.toISOString()}`,
    `Expiration Time: ${i.expiresAt.toISOString()}`,
  ].join("\n");
  return { message, chainId };
}
