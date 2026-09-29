import { pgSchema } from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const userStatus = app.enum("user_status", ["pending", "active", "suspended"]);
export const walletStatus = app.enum("wallet_status", ["active", "inactive"]);
export const addressStatus = app.enum("address_status", ["active", "disabled"]);
export const chainFamily = app.enum("chain_family", ["evm", "solana"]);
export const chain = app.enum("chain", ["ethereum", "base", "bnb", "arbitrum", "solana"]);
export const verificationMethod = app.enum("verification_method", ["eoa_ecdsa", "erc1271", "erc6492", "ed25519"]);
export const challengePurpose = app.enum("challenge_purpose", ["sign_in", "add_chain_account"]);
export const challengeStatus = app.enum("challenge_status", ["pending", "processing", "consumed", "rejected"]);
export const clientKind = app.enum("client_kind", ["web", "mobile"]);
export const revokeReason = app.enum("revoke_reason", ["logout", "logout_all", "user_revoked", "rotated", "user_suspended", "admin"]);
export const contactType = app.enum("contact_type", ["email", "phone"]);
export const contactStatus = app.enum("contact_status", ["unverified", "verified", "replaced"]);
export const otpChannel = app.enum("otp_channel", ["email", "sms"]);
export const verificationStatus = app.enum("contact_verification_status", ["pending", "verified", "superseded", "expired", "failed"]);
export const actorType = app.enum("actor_type", ["user", "ops", "system"]);
