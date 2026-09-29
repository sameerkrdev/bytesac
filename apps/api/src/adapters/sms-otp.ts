import twilio from "twilio";
import { DeliveryError } from "./email-sender.js";

export interface SmsOtpProvider {
  start(input: { to: string }): Promise<{ providerRef: string }>;
  check(input: { to: string; code: string }): Promise<"approved" | "rejected">;
}

export class TwilioVerifySmsOtp implements SmsOtpProvider {
  private readonly client: ReturnType<typeof twilio>;
  constructor(accountSid: string, authToken: string, private readonly serviceSid: string) { this.client = twilio(accountSid, authToken); }

  async start(input: { to: string }): Promise<{ providerRef: string }> {
    try {
      const v = await this.client.verify.v2.services(this.serviceSid).verifications.create({ to: input.to, channel: "sms" });
      return { providerRef: v.sid };
    } catch (err) {
      throw new DeliveryError("Twilio Verify start failed", { cause: err });
    }
  }

  async check(input: { to: string; code: string }): Promise<"approved" | "rejected"> {
    try {
      const r = await this.client.verify.v2.services(this.serviceSid).verificationChecks.create({ to: input.to, code: input.code });
      return r.status === "approved" ? "approved" : "rejected";
    } catch {
      return "rejected";
    }
  }
}
