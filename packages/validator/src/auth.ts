import { z } from "zod";
import { assetChainSchema } from "./assets";
import { signInChainSchema } from "./chains";

export const clientKindSchema = z.enum(["web", "mobile"]);
export type ClientKind = z.infer<typeof clientKindSchema>;

export const challengePurposeSchema = z.enum(["sign_in", "add_chain_account", "reassign_chain"]);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;

export const challengeRequestSchema = z.strictObject({
  purpose: challengePurposeSchema,
  chain: signInChainSchema,
  address: z.string().trim().min(1).max(128),
  /** D-120: chains to link with this address (same family). Omitted = every chain of the family (backward compatible). */
  chains: z.array(assetChainSchema).min(1).max(5).refine((c) => new Set(c).size === c.length, "Chains must be distinct").optional(),
});
export type ChallengeRequest = z.infer<typeof challengeRequestSchema>;

export const challengeResponseSchema = z.object({
  challengeId: z.uuid(),
  message: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const verifyRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  /** EVM: 0x-prefixed hex. Solana: base58 of the 64-byte ed25519 signature. */
  signature: z.string().min(1).max(20_000),
  walletProvider: z.string().trim().max(64).optional(),
  /** D-119: chains the connected wallet approved (e.g. the WalletConnect session); omitted when unknown. Used only for warnings. */
  signableChains: z.array(assetChainSchema).max(20).optional(),
  client: clientKindSchema,
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const verifyResponseSchema = z.object({
  userId: z.uuid(),
  isNewUser: z.boolean(),
  /** Present only for client "mobile" when a new session token was issued. */
  token: z.string().optional(),
});
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;
