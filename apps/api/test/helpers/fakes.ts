import type { EmailSender } from "../../src/adapters/email-sender.js";
import type { EvmRpc } from "../../src/adapters/evm-rpc.js";
import type { RateLimiter, RateLimitResult } from "../../src/adapters/rate-limiter.js";
import type { SmsOtpProvider } from "../../src/adapters/sms-otp.js";

export class FakeEvmRpc implements EvmRpc {
  behavior: "valid" | "invalid" | "unavailable" = "invalid";
  delayMs = 0;
  onCall: (() => Promise<void>) | null = null;
  calls: Array<{ chain: string; address: string }> = [];
  async verifyContractSignature(input: Parameters<EvmRpc["verifyContractSignature"]>[0]): Promise<boolean> {
    this.calls.push({ chain: input.chain, address: input.address });
    if (this.onCall) await this.onCall();
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.behavior === "unavailable") {
      const { VerifierUnavailableError } = await import("../../src/adapters/evm-rpc.js");
      throw new VerifierUnavailableError("rpc down");
    }
    return this.behavior === "valid";
  }
}

export class FakeEmailSender implements EmailSender {
  sent: Array<{ to: string; code: string }> = [];
  fail = false;
  async sendOtp(input: { to: string; code: string }): Promise<void> {
    if (this.fail) {
      const { DeliveryError } = await import("../../src/adapters/email-sender.js");
      throw new DeliveryError("resend down");
    }
    this.sent.push(input);
  }
}

export class FakeSmsOtp implements SmsOtpProvider {
  started: string[] = [];
  approveCode = "123456";
  fail = false;
  async start(input: { to: string }): Promise<{ providerRef: string }> {
    if (this.fail) {
      const { DeliveryError } = await import("../../src/adapters/email-sender.js");
      throw new DeliveryError("twilio down");
    }
    this.started.push(input.to);
    return { providerRef: `VE${this.started.length}` };
  }
  async check(input: { to: string; code: string }): Promise<"approved" | "rejected"> {
    return input.code === this.approveCode ? "approved" : "rejected";
  }
}

/** Allows everything unless a key prefix is listed in `deny`. */
export class FakeRateLimiter implements RateLimiter {
  deny: string[] = [];
  refunded: string[] = [];
  async consume(key: string): Promise<RateLimitResult> {
    const blocked = this.deny.some((p) => key.startsWith(p));
    return { allowed: !blocked, retryAfterSec: blocked ? 30 : 0, bucketKey: `${key}:b` };
  }
  async refund(bucketKey: string): Promise<void> { this.refunded.push(bucketKey); }
}
