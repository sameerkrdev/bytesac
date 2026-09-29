import { Resend } from "resend";

export class DeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "DeliveryError"; }
}
export interface EmailSender { sendOtp(input: { to: string; code: string }): Promise<void> }

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) { this.client = new Resend(apiKey); }

  async sendOtp(input: { to: string; code: string }): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: input.to,
      subject: "Your Bytesac verification code",
      text: `Your Bytesac verification code is ${input.code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
    });
    if (error) throw new DeliveryError("Resend rejected the email", { cause: error });
  }
}
