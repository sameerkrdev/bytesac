import { z } from "zod";
import { chainFamilySchema, chainSchema } from "./chains";
import { clientKindSchema } from "./auth";
import { contactViewSchema } from "./contacts";

export const verificationMethodSchema = z.enum(["eoa_ecdsa", "erc1271", "erc6492", "ed25519"]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const walletAddressViewSchema = z.object({
  chain: chainSchema,
  chainFamily: chainFamilySchema,
  address: z.string(),
  status: z.enum(["active", "disabled"]),
  verificationMethod: verificationMethodSchema,
  verifiedAt: z.iso.datetime({ offset: true }),
});
export type WalletAddressView = z.infer<typeof walletAddressViewSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: z.uuid(), status: z.enum(["pending", "active", "suspended"]), createdAt: z.iso.datetime({ offset: true }) }),
  wallet: z.object({
    id: z.uuid(),
    walletProvider: z.string().nullable(),
    addresses: z.array(walletAddressViewSchema),
  }),
  contacts: z.array(contactViewSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const sessionViewSchema = z.object({
  id: z.uuid(),
  client: clientKindSchema,
  createdAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  userAgent: z.string().nullable(),
  ipPrefix: z.string().nullable(),
  current: z.boolean(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const sessionsResponseSchema = z.object({ sessions: z.array(sessionViewSchema) });
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
