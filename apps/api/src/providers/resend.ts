import createHttpError from "http-errors";
import { Resend } from "resend";
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
