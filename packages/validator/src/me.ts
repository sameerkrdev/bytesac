import { z } from "zod";
import { assetChainSchema } from "./assets";
import { chainFamilySchema, chainSchema } from "./chains";
import { clientKindSchema } from "./auth";
import { contactViewSchema } from "./contacts";
import { platformRoleSchema } from "./managers";
import { organizationSummarySchema } from "./organizations";

export const verificationMethodSchema = z.enum(["eoa_ecdsa", "erc1271", "erc6492", "ed25519", "bip322", "bip137"]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const walletAddressViewSchema = z.object({
  chain: chainSchema,
  chainFamily: chainFamilySchema,
  address: z.string(),
  status: z.enum(["active", "disabled", "replaced"]),
  /** D-120: the wallet app reported when this chain was linked. */
  walletName: z.string().nullish(),
  verificationMethod: verificationMethodSchema,
  verifiedAt: z.iso.datetime({ offset: true }),
  /** D-119: chains the wallet can sign for this address; null = unknown. */
  signableChains: z.array(assetChainSchema).nullish(),
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
  /** Granted product permissions, e.g. create_manager_organization. */
  permissions: z.array(z.enum(["create_manager_organization"])),
  /** Active platform roles (ops_reviewer, ops_admin). */
  platformRoles: z.array(platformRoleSchema),
  /** Open memberships (not invited, rejected or revoked); `status` is the organization status. */
  organizations: z.array(organizationSummarySchema.pick({ id: true, displayName: true, role: true, status: true, membershipId: true, membershipStatus: true })),
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
