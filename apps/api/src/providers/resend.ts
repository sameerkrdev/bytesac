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
