import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import {
  app, chain, chainFamily, documentStatus, membershipRole, membershipStatus, organizationActor, organizationEventKind, organizationStatus, organizationType,
  payoutWalletStatus, scanStatus, templateSubject, versionStatus,
} from "./enums";
import { authChallenges, users } from "./identity";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const organizations = app.table(
  "organizations",
  {
    id: id(),
    type: organizationType("type").notNull(),
    status: organizationStatus("status").notNull().default("DRAFT"),
    /** ISO 3166-1 alpha-2. */
    jurisdiction: text("jurisdiction").notNull(),
    /** The approved, publicly shown version. */
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => organizationVersions.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    submittedAt: ts("submitted_at"),
    verifiedAt: ts("verified_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organizations_one_open_per_user").on(t.createdByUserId).where(sql`${t.status} <> 'REJECTED'`),
    index("organizations_queue_idx").on(t.updatedAt, t.id),
  ],
);

export const organizationMemberships = app.table(
  "organization_memberships",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Null while the invite waits for wallet proof, or after such an invite was revoked. */
    userId: uuid("user_id").references(() => users.id),
    role: membershipRole("role").notNull(),
    status: membershipStatus("status").notNull(),
    /** A pending upgrade to ADMIN/MANAGER; the current role's permissions apply until ops approve it. */
    requestedRole: membershipRole("requested_role"),
    invitedWalletChain: chain("invited_wallet_chain"),
    invitedWalletFamily: chainFamily("invited_wallet_family"),
    /** Canonical. An identifier only: it never links anyone without a wallet proof. */
    invitedWalletAddress: text("invited_wallet_address"),
    /** Lowercased, unverified, notification only. */
    invitedEmail: text("invited_email"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
    inviteExpiresAt: ts("invite_expires_at"),
    removalRequestedByUserId: uuid("removal_requested_by_user_id").references(() => users.id),
    publicDisplayName: text("public_display_name"),
    publicTitle: text("public_title"),
    /** First time the membership became ACTIVE. */
    activatedAt: ts("activated_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    leftAt: ts("left_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_memberships_one_open").on(t.organizationId, t.userId).where(sql`${t.userId} is not null and ${t.status} not in ('REJECTED', 'REVOKED')`),
    uniqueIndex("organization_memberships_one_open_invite").on(t.organizationId, t.invitedWalletFamily, t.invitedWalletAddress).where(sql`${t.status} in ('PENDING_WALLET_VERIFICATION', 'INVITED')`),
    uniqueIndex("organization_memberships_one_owner").on(t.organizationId).where(sql`${t.role} = 'OWNER' and ${t.status} = 'ACTIVE'`),
    index("organization_memberships_user_idx").on(t.userId),
    index("organization_memberships_wallet_idx").on(t.invitedWalletFamily, t.invitedWalletAddress),
    check("organization_memberships_user_or_pending", sql`${t.userId} is not null or ${t.status} in ('PENDING_WALLET_VERIFICATION', 'REVOKED')`),
  ],
);

export const organizationVersions = app.table(
  "organization_versions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references((): AnyPgColumn => organizations.id),
    versionNumber: integer("version_number").notNull(),
    status: versionStatus("status").notNull().default("draft"),
    publicProfile: jsonb("public_profile").$type<Record<string, unknown>>().notNull().default({}),
    privateDetails: jsonb("private_details").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_versions_number_key").on(t.organizationId, t.versionNumber),
    uniqueIndex("organization_versions_one_open").on(t.organizationId).where(sql`${t.status} in ('draft', 'in_review', 'changes_required')`),
  ],
);

export const organizationDocuments = app.table(
  "organization_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** Set for a member verification document; organization_id stays so one upload flow serves both. */
    membershipId: uuid("membership_id").references((): AnyPgColumn => organizationMemberships.id),
    documentType: text("document_type").notNull(),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: documentStatus("status").notNull().default("pending_upload"),
    scanStatus: scanStatus("scan_status").notNull().default("not_scanned"),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    uploadedAt: ts("uploaded_at"),
  },
  (t) => [index("organization_documents_org_idx").on(t.organizationId, t.createdAt)],
);

/** A link is never deleted: `removed_at` unlinks it, so the runtime role needs no DELETE. */
export const organizationVersionDocuments = app.table(
  "organization_version_documents",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => organizationVersions.id),
    documentId: uuid("document_id").notNull().references(() => organizationDocuments.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
  },
  (t) => [uniqueIndex("organization_version_documents_active").on(t.versionId, t.documentId).where(sql`${t.removedAt} IS NULL`)],
);

export const verificationRequirementTemplates = app.table(
  "verification_requirement_templates",
  {
    id: id(),
    subject: templateSubject("subject").notNull(),
    /** Null = default for the subject. */
    jurisdiction: text("jurisdiction"),
    requiredFields: text("required_fields").array().notNull(),
    requiredDocuments: text("required_documents").array().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    retiredAt: ts("retired_at"),
  },
  (t) => [uniqueIndex("verification_requirement_templates_active").on(t.subject, sql`coalesce(${t.jurisdiction}, '')`).where(sql`${t.retiredAt} IS NULL`)],
);

export const organizationPayoutWallets = app.table(
  "organization_payout_wallets",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    chain: chain("chain").notNull().default("solana"),
    address: text("address").notNull(),
    status: payoutWalletStatus("status").notNull().default("UNVERIFIED"),
    /** Signature time. */
    verifiedAt: ts("verified_at"),
    /** The signed proof: the challenge (kept by retention) and the signature over its message. */
    verificationChallengeId: uuid("verification_challenge_id").references(() => authChallenges.id),
    verificationSignature: text("verification_signature"),
    activatedAt: ts("activated_at"),
    deactivatedAt: ts("deactivated_at"),
    requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_payout_wallets_one_verified").on(t.organizationId).where(sql`${t.status} = 'VERIFIED'`),
    uniqueIndex("organization_payout_wallets_one_pending").on(t.organizationId).where(sql`${t.status} in ('UNVERIFIED', 'VERIFYING', 'REPLACEMENT_PENDING')`),
    check("organization_payout_wallets_solana", sql`${t.chain} = 'solana'`),
  ],
);

export const organizationEvents = app.table(
  "organization_events",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    actorType: organizationActor("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    kind: organizationEventKind("kind").notNull(),
    fromStatus: organizationStatus("from_status"),
    toStatus: organizationStatus("to_status"),
    versionId: uuid("version_id").references(() => organizationVersions.id),
    payoutWalletId: uuid("payout_wallet_id").references(() => organizationPayoutWallets.id),
    /** Outcome of a decision event: approved, changes_required, rejected. */
    decision: text("decision"),
    internalNote: text("internal_note"),
    messageToOwner: text("message_to_owner"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("organization_events_org_idx").on(t.organizationId, t.createdAt)],
);
