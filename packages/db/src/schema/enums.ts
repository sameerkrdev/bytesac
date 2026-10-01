import { pgSchema } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const userStatus = app.enum("user_status", ["pending", "active", "suspended"]);
export const walletStatus = app.enum("wallet_status", ["active", "inactive"]);
export const addressStatus = app.enum("address_status", ["active", "disabled"]);
export const chainFamily = app.enum("chain_family", ["evm", "solana", "bitcoin"]);
export const chain = app.enum("chain", ["ethereum", "base", "bnb", "arbitrum", "solana", "bitcoin"]);
export const verificationMethod = app.enum("verification_method", ["eoa_ecdsa", "erc1271", "erc6492", "ed25519", "bip322", "bip137"]);
export const challengePurpose = app.enum("challenge_purpose", ["sign_in", "add_chain_account", "payout_wallet"]);
export const challengeStatus = app.enum("challenge_status", ["pending", "processing", "consumed", "rejected"]);
export const clientKind = app.enum("client_kind", ["web", "mobile"]);
export const revokeReason = app.enum("revoke_reason", ["logout", "logout_all", "user_revoked", "rotated", "user_suspended", "admin"]);
export const contactType = app.enum("contact_type", ["email", "phone"]);
export const contactStatus = app.enum("contact_status", ["unverified", "verified", "replaced"]);
export const otpChannel = app.enum("otp_channel", ["email", "sms"]);
export const verificationStatus = app.enum("contact_verification_status", ["pending", "verified", "superseded", "expired", "failed"]);
export const actorType = app.enum("actor_type", ["user", "ops", "system"]);
export const applicationStatus = app.enum("application_status", ["EMAIL_PENDING", "SUBMITTED", "SCREENING", "CONTACTED", "ADDITIONAL_INFORMATION_REQUIRED", "SCREENING_APPROVED", "SCREENING_REJECTED"]);
export const applicantType = app.enum("applicant_type", ["individual", "firm"]);
export const applicationActor = app.enum("application_actor", ["applicant", "ops", "system"]);
export const applicationEventKind = app.enum("application_event_kind", ["status_changed", "note", "applicant_reply", "permission_granted"]);
export const emailCodeStatus = app.enum("email_code_status", ["pending", "verified", "superseded", "failed"]);
export const platformRole = app.enum("platform_role", ["ops_reviewer", "ops_admin"]);
export const userPermission = app.enum("user_permission", ["create_manager_organization"]);
export const organizationType = app.enum("organization_type", ["individual", "firm"]);
export const organizationStatus = app.enum("organization_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "RESUBMITTED", "VERIFIED", "REJECTED"]);
export const membershipRole = app.enum("membership_role", ["OWNER", "ADMIN", "MANAGER", "ANALYST", "VIEWER"]);
export const membershipStatus = app.enum("membership_status", [
  "PENDING_WALLET_VERIFICATION", "INVITED", "PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "ACTIVE", "REJECTED", "REMOVAL_REQUESTED", "REVOKED",
]);
export const templateSubject = app.enum("template_subject", ["individual", "firm", "member"]);
export const memberVerificationStatus = app.enum("member_verification_status", ["draft", "in_review", "changes_required", "approved", "rejected"]);
export const membershipActor = app.enum("membership_actor", ["member", "org", "ops", "system"]);
export const membershipEventKind = app.enum("membership_event_kind", [
  "invited", "linked", "accepted", "declined", "cancelled", "expired", "verification_submitted", "verification_decided", "role_changed", "role_requested",
  "removal_requested", "removal_cancelled", "removed", "left", "ownership_transferred", "profile_updated",
]);
export const versionStatus = app.enum("organization_version_status", ["draft", "in_review", "changes_required", "approved", "rejected", "superseded"]);
export const documentStatus = app.enum("organization_document_status", ["pending_upload", "uploaded", "rejected_file"]);
export const scanStatus = app.enum("document_scan_status", ["not_scanned"]);
export const payoutWalletStatus = app.enum("payout_wallet_status", ["UNVERIFIED", "VERIFYING", "VERIFIED", "REPLACEMENT_PENDING", "REVOKED"]);
export const organizationActor = app.enum("organization_actor", ["owner", "ops", "system"]);
export const organizationEventKind = app.enum("organization_event_kind", ["status_changed", "note", "version_submitted", "version_decided", "document_uploaded", "document_unlinked", "version_created", "payout_wallet_changed"]);
