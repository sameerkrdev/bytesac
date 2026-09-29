import { z } from "zod";
import { chainSchema } from "./chains";

export const clientKindSchema = z.enum(["web", "mobile"]);
export type ClientKind = z.infer<typeof clientKindSchema>;

export const challengePurposeSchema = z.enum(["sign_in", "add_chain_account"]);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;

export const challengeRequestSchema = z.strictObject({
  purpose: challengePurposeSchema,
  chain: chainSchema,
  address: z.string().trim().min(1).max(128),
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
