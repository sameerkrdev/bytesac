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
  application: Array<{ kind: string; to: string; data: { code?: string; link?: string; message?: string | null; walletLabel?: string }; idempotencyKey: string }> = [];
  sendApplication = async (kind: string, to: string, data: { code?: string; link?: string; message?: string | null; walletLabel?: string }, idempotencyKey: string): Promise<void> => {
    if (this.fail && kind === "code") throw deliveryFailure("resend down");
    this.application.push({ kind, to, data, idempotencyKey });
  };
  organization: Array<{ kind: string; to: string; data: { message?: string | null; decision?: string }; idempotencyKey: string }> = [];
  sendOrganization = async (kind: string, to: string, data: { message?: string | null; decision?: string }, idempotencyKey: string): Promise<void> => {
    this.organization.push({ kind, to, data, idempotencyKey });
  };
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

interface R2Command { constructor: { name: string }; input: { Key?: string; CopySource?: string; Range?: string; ContentType?: string } }

/** In-memory R2: bodies are stored per key so HEAD, ranged GET, copy and delete behave like the real bucket. */
class FakeR2 {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  signed: Array<{ command: R2Command["constructor"]["name"]; input: R2Command["input"] & Record<string, unknown>; options: unknown }> = [];
  /** What the browser's presigned PUT would do. */
  put(key: string, body: Buffer, contentType: string): void { this.objects.set(key, { body, contentType }); }
  send = async (cmd: R2Command): Promise<Record<string, unknown>> => {
    const { Key, CopySource, Range } = cmd.input;
    switch (cmd.constructor.name) {
      case "HeadObjectCommand": {
        const o = this.objects.get(Key!);
        if (!o) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
        return { ContentLength: o.body.length, ContentType: o.contentType };
      }
      case "GetObjectCommand": {
        const o = this.objects.get(Key!);
        if (!o) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(Range ?? "") ?? [];
        const bytes = Range ? o.body.subarray(Number(from), Number(to) + 1) : o.body;
        return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
      }
      case "CopyObjectCommand": {
        const source = this.objects.get(CopySource!.slice(CopySource!.indexOf("/") + 1));
        if (!source) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        this.objects.set(Key!, { ...source });
        return {};
      }
      case "DeleteObjectCommand":
        this.objects.delete(Key!);
        return {};
      default:
        throw new Error(`FakeR2: unexpected ${cmd.constructor.name}`);
    }
  };
  getSignedUrl = async (_client: unknown, command: R2Command, options: unknown): Promise<string> => {
    this.signed.push({ command: command.constructor.name, input: command.input as never, options });
    return `https://r2.test/${command.input.Key}?sig`;
  };
}

export const fakes = { evm: new FakeEvmRpc(), email: new FakeEmail(), sms: new FakeSms(), r2: new FakeR2() };

export function resetFakes(): void {
  Object.assign(fakes.evm, { behavior: "invalid", delayMs: 0, onCall: null, calls: [] });
  Object.assign(fakes.email, { sent: [], application: [], organization: [], fail: false });
  fakes.r2.objects.clear();
  fakes.r2.signed = [];
  Object.assign(fakes.sms, { started: [], approveCode: "123456", fail: false, checkFail: false });
}
