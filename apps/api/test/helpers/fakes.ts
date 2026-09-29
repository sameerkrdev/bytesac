import createHttpError from "http-errors";

const deliveryFailure = (message: string) => createHttpError(503, message, { code: "OTP_DELIVERY_FAILED" });

/** In-memory stand-ins for the provider modules (see test/setup.ts). Bound methods, so they can be passed as plain functions. */
class FakeEvmRpc {
  behavior: "valid" | "invalid" | "unavailable" = "invalid";
  delayMs = 0;
  onCall: (() => Promise<void>) | null = null;
  calls: Array<{ chain: string; address: string }> = [];
  verifyContractSignature = async (input: { chain: string; address: string }): Promise<boolean> => {
    this.calls.push({ chain: input.chain, address: input.address });
    if (this.onCall) await this.onCall();
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.behavior === "unavailable") throw createHttpError(503, "rpc down", { code: "VERIFIER_UNAVAILABLE" });
    return this.behavior === "valid";
  };
}

class FakeEmail {
  sent: Array<{ to: string; code: string; verificationId: string }> = [];
  fail = false;
  sendOtp = async (to: string, code: string, verificationId: string): Promise<void> => {
    if (this.fail) throw deliveryFailure("resend down");
    this.sent.push({ to, code, verificationId });
  };
}

class FakeSms {
  started: string[] = [];
  approveCode = "123456";
  fail = false;
  checkFail = false;
  start = async (to: string): Promise<string> => {
    if (this.fail) throw deliveryFailure("twilio down");
    this.started.push(to);
    return `VE${this.started.length}`;
  };
  check = async (_to: string, code: string): Promise<boolean> => {
    if (this.checkFail) throw deliveryFailure("twilio check down");
    return code === this.approveCode;
  };
}

export const fakes = { evm: new FakeEvmRpc(), email: new FakeEmail(), sms: new FakeSms() };

export function resetFakes(): void {
  Object.assign(fakes.evm, { behavior: "invalid", delayMs: 0, onCall: null, calls: [] });
  Object.assign(fakes.email, { sent: [], fail: false });
  Object.assign(fakes.sms, { started: [], approveCode: "123456", fail: false, checkFail: false });
}
