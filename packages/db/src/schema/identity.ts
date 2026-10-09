import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import {
  addressStatus, app, chain, chainFamily, challengePurpose, challengeStatus, clientKind, revokeReason,
  userStatus, verificationMethod, walletStatus,
} from "./enums";
import { organizations } from "./organizations";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = app.table("users", {
  id: id(),
  status: userStatus("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const investmentWallets = app.table(
  "investment_wallets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    walletProvider: text("wallet_provider"),
    status: walletStatus("status").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("investment_wallets_one_active_per_user").on(t.userId).where(sql`${t.status} = 'active'`)],
);

export const sessions = app.table(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique("sessions_token_hash_key"),
    client: clientKind("client").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    revokeReason: revokeReason("revoke_reason"),
    replacedBySessionId: uuid("replaced_by_session_id").references((): AnyPgColumn => sessions.id, { onDelete: "set null" }),
    userAgent: text("user_agent"),
    ipPrefix: text("ip_prefix"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const authChallenges = app.table(
  "auth_challenges",
  {
    id: id(),
    nonce: text("nonce").notNull().unique("auth_challenges_nonce_key"),
    purpose: challengePurpose("purpose").notNull(),
    chainFamily: chainFamily("chain_family").notNull(),
    chain: chain("chain").notNull(),
    address: text("address").notNull(),
    message: text("message").notNull(),
    domain: text("domain").notNull(),
    uri: text("uri").notNull(),
    chainId: text("chain_id").notNull(),
    status: challengeStatus("status").notNull().default("pending"),
    claimId: uuid("claim_id"),
    leaseExpiresAt: ts("lease_expires_at"),
    issuedAt: ts("issued_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references((): AnyPgColumn => organizations.id),
  },
  (t) => [
    index("auth_challenges_expires_at_idx").on(t.expiresAt),
    check("auth_challenges_session_for_add", sql`${t.purpose} <> 'add_chain_account' OR ${t.sessionId} IS NOT NULL OR ${t.status} <> 'pending'`),
    check("auth_challenges_org_for_payout", sql`${t.purpose}::text <> 'payout_wallet' OR (${t.organizationId} IS NOT NULL AND ${t.sessionId} IS NOT NULL)`),
  ],
);

export const walletAddresses = app.table(
  "wallet_addresses",
  {
    id: id(),
    investmentWalletId: uuid("investment_wallet_id").notNull().references(() => investmentWallets.id),
    chainFamily: chainFamily("chain_family").notNull(),
    chain: chain("chain").notNull(),
    address: text("address").notNull(),
    status: addressStatus("status").notNull().default("active"),
    verificationMethod: verificationMethod("verification_method").notNull(),
    verifiedOnChain: chain("verified_on_chain").notNull(),
    verificationChallengeId: uuid("verification_challenge_id").references(() => authChallenges.id),
    verifiedAt: ts("verified_at").notNull().defaultNow(),
    disabledAt: ts("disabled_at"),
    disabledReason: text("disabled_reason"),
    /** D-119: asset chains the wallet approved when it last signed for this address (client-reported, warnings only); null = unknown. */
    signableChains: text("signable_chains").array(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_addresses_chain_address_key").on(t.chain, t.address),
    index("wallet_addresses_wallet_idx").on(t.investmentWalletId),
    // ::text casts: a value added to an enum in the same migration cannot be referenced as an enum literal.
    check("wallet_addresses_chain_family", sql`(${t.chainFamily}::text = 'solana') = (${t.chain}::text = 'solana') and (${t.chainFamily}::text = 'bitcoin') = (${t.chain}::text = 'bitcoin')`),
    check("wallet_addresses_method_family", sql`(${t.chainFamily}::text = 'solana') = (${t.verificationMethod}::text = 'ed25519') and (${t.chainFamily}::text = 'bitcoin') = (${t.verificationMethod}::text in ('bip322', 'bip137'))`),
    check("wallet_addresses_disabled_reason", sql`${t.status} = 'active' OR ${t.disabledReason} IS NOT NULL`),
  ],
);
