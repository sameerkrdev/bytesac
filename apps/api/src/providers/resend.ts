import createHttpError from "http-errors";
import { Resend } from "resend";
import { logger } from "@repo/logger";
import { env } from "../env";

const resend = new Resend(env.RESEND_API_KEY);

/**
 * Emails the OTP. The idempotency key (`<event-type>/<entity-id>`, valid 24 h) stops a retried request from sending a second code.
 * The SDK reports failures, network ones included, in `error` instead of throwing.
 */
export async function sendOtpEmail(to: string, code: string, verificationId: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "Your Bytesac verification code",
    text: `Your Bytesac verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
  }, { idempotencyKey: `contact-otp/${verificationId}` });
  if (error) throw createHttpError("We couldn't send the code. Try again shortly.", { code: "OTP_DELIVERY_FAILED", cause: error });
}

export type ApplicationEmailKind = "code" | "status_link" | "contacted" | "info_required" | "approved" | "rejected";
export interface ApplicationEmailData { code?: string; link?: string; message?: string | null; walletLabel?: string }

const withMessage = (m?: string | null) => (m ? `\n\nMessage from the Bytesac team:\n${m}` : "");

const APPLICATION_EMAILS: Record<ApplicationEmailKind, (d: ApplicationEmailData) => { subject: string; text: string }> = {
  code: (d) => ({ subject: "Confirm your Bytesac application", text: `Your Bytesac confirmation code is ${d.code}. It expires in 10 minutes. If you didn't apply, ignore this email.` }),
  status_link: (d) => ({ subject: "Your Bytesac application status link", text: `Your application was received. Follow its progress at ${d.link}\nKeep this link private: anyone with it can see your application status.` }),
  contacted: (d) => ({ subject: "Bytesac application: we will contact you", text: `The Bytesac team is contacting you about your application.${withMessage(d.message)}` }),
  info_required: (d) => ({ subject: "Bytesac application: more information needed", text: `We need more information to continue screening your application. Open your status link to reply.${withMessage(d.message)}` }),
  approved: (d) => ({ subject: "Bytesac application approved", text: `Your application passed screening. Sign in to Bytesac with wallet ${d.walletLabel} to finish.${withMessage(d.message)}` }),
  rejected: (d) => ({ subject: "Bytesac application decision", text: `We are unable to approve your application at this time.${withMessage(d.message)}` }),
};

/** Sends an application email. Code delivery failures throw 503 OTP_DELIVERY_FAILED; status emails only log, so a status change never rolls back. */
export async function sendApplicationEmail(kind: ApplicationEmailKind, to: string, data: ApplicationEmailData, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, ...APPLICATION_EMAILS[kind](data) }, { idempotencyKey });
  if (!error) return;
  if (kind === "code") throw createHttpError("We couldn't send the code. Try again shortly.", { code: "OTP_DELIVERY_FAILED", cause: error });
  logger.warn("application email failed", { kind, errorName: error.name });
}

export type OrganizationEmailKind = "changes_required" | "verified" | "rejected" | "change_request_decided" | "payout_replacement_requested" | "payout_replacement_decided";
export interface OrganizationEmailData { message?: string | null; decision?: "approved" | "changes_required" | "rejected" }

const decisionText = (d?: string) => (d === "approved" ? "approved" : d === "rejected" ? "not approved" : "returned to you for changes");

const ORGANIZATION_EMAILS: Record<OrganizationEmailKind, (d: OrganizationEmailData) => { subject: string; text: string }> = {
  changes_required: (d) => ({ subject: "Bytesac organization: changes required", text: `Your organization needs changes before it can be verified. Sign in to Bytesac to review them and resubmit.${withMessage(d.message)}` }),
  verified: () => ({ subject: "Bytesac organization verified", text: "Your organization is verified and its public profile is live." }),
  rejected: (d) => ({ subject: "Bytesac organization decision", text: `We are unable to verify your organization at this time.${withMessage(d.message)}` }),
  change_request_decided: (d) => ({ subject: "Bytesac profile change decision", text: `Your profile change request was ${decisionText(d.decision)}.${withMessage(d.message)}` }),
  payout_replacement_requested: () => ({ subject: "Bytesac payout wallet change received", text: "Your new payout wallet was proven and is awaiting review. Your current payout wallet stays active until the change is approved." }),
  payout_replacement_decided: (d) => ({ subject: "Bytesac payout wallet change decision", text: `Your payout wallet change was ${decisionText(d.decision)}.` }),
};

/** Sends an organization email. Failures only log: a state change never rolls back for an undelivered notice. */
export async function sendOrganizationEmail(kind: OrganizationEmailKind, to: string, data: OrganizationEmailData, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, ...ORGANIZATION_EMAILS[kind](data) }, { idempotencyKey });
  if (error) logger.warn("organization email failed", { kind, errorName: error.name });
}

export type MembershipEmailKind = "invited" | "accepted" | "verification_changes_required" | "verification_approved" | "verification_rejected" | "removed" | "ownership_transferred";
export interface MembershipEmailData { organizationName?: string | null; role?: string; message?: string | null }

const MEMBERSHIP_EMAILS: Record<MembershipEmailKind, (d: MembershipEmailData) => { subject: string; text: string }> = {
  invited: (d) => ({ subject: `You are invited to ${d.organizationName ?? "an organization"} on Bytesac`, text: `You were invited to join ${d.organizationName ?? "an organization"} on Bytesac as ${d.role}. Sign in with the invited wallet at ${env.AUTH_URI} to review the invitation. It expires in 14 days.` }),
  accepted: (d) => ({ subject: "Bytesac invitation accepted", text: `Your invitation to join ${d.organizationName ?? "your organization"} as ${d.role} was accepted.` }),
  verification_changes_required: (d) => ({ subject: "Bytesac member verification: changes required", text: `Your member verification for ${d.organizationName ?? "the organization"} needs changes. Sign in to Bytesac to review them and resubmit.${withMessage(d.message)}` }),
  verification_approved: (d) => ({ subject: "Bytesac member verification approved", text: `Your member verification for ${d.organizationName ?? "the organization"} was approved.` }),
  verification_rejected: (d) => ({ subject: "Bytesac member verification decision", text: `We are unable to approve your member verification for ${d.organizationName ?? "the organization"}.${withMessage(d.message)}` }),
  removed: (d) => ({ subject: "Bytesac organization access removed", text: `Your access to ${d.organizationName ?? "the organization"} on Bytesac was removed.` }),
  ownership_transferred: (d) => ({ subject: "Bytesac organization ownership transferred", text: `Ownership of ${d.organizationName ?? "the organization"} on Bytesac was transferred by the Bytesac team. Your role is now ${d.role}.` }),
};

/** Sends a membership email. Failures only log: a state change never rolls back for an undelivered notice. */
export async function sendMembershipEmail(kind: MembershipEmailKind, to: string, data: MembershipEmailData, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, ...MEMBERSHIP_EMAILS[kind](data) }, { idempotencyKey });
  if (error) logger.warn("membership email failed", { kind, errorName: error.name });
}

export type BasketEmailKind = "submitted" | "changes_required" | "approved" | "rejected" | "published" | "platform_paused" | "platform_resumed" | "retirement_decided" | "retired" | "reassignment_required" | "lead_approved" | "lead_rejected";
export interface BasketEmailData { basketName?: string | null; message?: string | null; decision?: "approved" | "rejected" }

const basketLabel = (d: BasketEmailData) => d.basketName ?? "your basket";

const BASKET_EMAILS: Record<BasketEmailKind, (d: BasketEmailData) => { subject: string; text: string }> = {
  submitted: (d) => ({ subject: "Bytesac basket submitted for review", text: `A version of ${basketLabel(d)} was submitted for review. Nothing is published until the Bytesac team approves it and a manager publishes it.` }),
  changes_required: (d) => ({ subject: "Bytesac basket: changes required", text: `${basketLabel(d)} needs changes before it can be approved. Sign in to Bytesac to review them and resubmit.${withMessage(d.message)}` }),
  approved: (d) => ({ subject: "Bytesac basket version approved", text: `The submitted version of ${basketLabel(d)} was approved. It is not public until a manager publishes it.` }),
  rejected: (d) => ({ subject: "Bytesac basket version decision", text: `We are unable to approve the submitted version of ${basketLabel(d)}.${withMessage(d.message)}` }),
  published: (d) => ({ subject: "Bytesac basket version published", text: `A new version of ${basketLabel(d)} is now published on Bytesac. No assets were moved and no fees were charged.` }),
  platform_paused: (d) => ({ subject: "Bytesac basket paused", text: `${basketLabel(d)} was paused by the Bytesac team.${withMessage(d.message)}` }),
  platform_resumed: (d) => ({ subject: "Bytesac basket resumed", text: `${basketLabel(d)} was resumed by the Bytesac team.` }),
  retirement_decided: (d) => ({ subject: "Bytesac basket retirement decision", text: `Your request to retire ${basketLabel(d)} was ${d.decision === "approved" ? "approved; the basket is retired" : "declined; the basket continues"}.${withMessage(d.message)}` }),
  retired: (d) => ({ subject: "Bytesac basket retired", text: `${basketLabel(d)} was retired by the Bytesac team.${withMessage(d.message)}` }),
  reassignment_required: (d) => ({ subject: "Bytesac basket needs a new lead manager", text: `${basketLabel(d)} has no active lead manager. Assign a new lead in Bytesac; the Bytesac team must approve the change.` }),
  lead_approved: (d) => ({ subject: "Bytesac lead manager approved", text: `The new lead manager of ${basketLabel(d)} was approved.` }),
  lead_rejected: (d) => ({ subject: "Bytesac lead manager not approved", text: `The proposed lead manager of ${basketLabel(d)} was not approved.${withMessage(d.message)}` }),
};

/** Sends a basket email. Failures only log: a state change never rolls back for an undelivered notice. The text never claims assets moved. */
export async function sendBasketEmail(kind: BasketEmailKind, to: string, data: BasketEmailData, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, ...BASKET_EMAILS[kind](data) }, { idempotencyKey });
  if (error) logger.warn("basket email failed", { kind, errorName: error.name });
}

export type ProfileEmailKind = "hidden" | "unhidden";
export interface ProfileEmailData { message?: string | null }

const PROFILE_EMAILS: Record<ProfileEmailKind, (d: ProfileEmailData) => { subject: string; text: string }> = {
  hidden: (d) => ({ subject: "Bytesac manager profile hidden", text: `Your public manager profile was hidden by the Bytesac team and can no longer be published by you.${withMessage(d.message)}` }),
  unhidden: () => ({ subject: "Bytesac manager profile restored", text: "Your manager profile was restored by the Bytesac team. It stays unpublished until you publish it again." }),
};

/** Sends a manager-profile email. Failures only log: a moderation change never rolls back for an undelivered notice. */
export async function sendProfileEmail(kind: ProfileEmailKind, to: string, data: ProfileEmailData, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, ...PROFILE_EMAILS[kind](data) }, { idempotencyKey });
  if (error) logger.warn("profile email failed", { kind, errorName: error.name });
}

/** Emails an inbox notification (the same copy as the inbox: it never says a trade happened). `link` is a path in the web app. Failures only log. */
export async function sendNotificationEmail(to: string, n: { title: string; body: string; link: string }, idempotencyKey: string): Promise<void> {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject: n.title, text: `${n.body}\n\n${env.AUTH_URI}${n.link}` }, { idempotencyKey });
  if (error) logger.warn("notification email failed", { errorName: error.name });
}
