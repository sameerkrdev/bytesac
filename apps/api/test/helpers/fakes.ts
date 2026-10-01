import createHttpError from "http-errors";

const deliveryFailure = (message: string) => createHttpError(503, message, { code: "OTP_DELIVERY_FAILED" });

/** In-memory stand-ins for the provider modules (see test/setup.ts). Bound methods, so they can be passed as plain functions. */
class FakeEvmRpc {
  behavior: "valid" | "invalid" | "unavailable" = "invalid";
  delayMs = 0;
  onCall: (() => Promise<void>) | null = null;
  calls: Array<{ chain: string; address: string }> = [];
  tokenBehavior: "ok" | "unavailable" = "ok";
  /** What readTokenMetadata returns while tokenBehavior is "ok"; null = not a token. */
  token: { decimals: number; symbol: string | null; name: string | null } | null = { decimals: 18, symbol: "TKN", name: "Token" };
  tokenCalls: Array<{ chain: string; address: string }> = [];
  readTokenMetadata = async (input: { chain: string; address: string }) => {
    this.tokenCalls.push(input);
    if (this.tokenBehavior === "unavailable") throw createHttpError(503, "rpc down", { code: "VERIFIER_UNAVAILABLE" });
    return this.token;
  };
  /** Native balances by `chain:address`; ERC-20 by `chain:address:token`. Unlisted = 0. */
  balances = new Map<string, bigint>();
  transactions = new Map<string, { from: string; to: string | null; input: string; value: bigint; blockNumber: bigint | null }>();
  receipts = new Map<string, { success: boolean; blockNumber: bigint; head: bigint; logs: Array<{ address: string; topics: string[]; data: string }> }>();
  sentNative: Array<{ chain: string; to: string; value: bigint }> = [];
  sendFails = false;
  /** The node definitively refuses the send (insufficient funds, nonce). */
  sendRefused = false;
  evmBalance = async (chain: string, owner: string, token: string | null): Promise<bigint> => this.balances.get(`${chain}:${owner.toLowerCase()}${token ? ":" + token.toLowerCase() : ""}`) ?? 0n;
  /** Native amounts received per `hash:owner`; unlisted = receipt not found. */
  nativeReceived = new Map<string, bigint>();
  evmNativeReceived = async (_chain: string, owner: string, hash: string): Promise<bigint | null> => this.nativeReceived.get(`${hash}:${owner.toLowerCase()}`) ?? null;
  evmTransaction = async (_chain: string, hash: string) => this.transactions.get(hash) ?? null;
  evmReceipt = async (_chain: string, hash: string) => this.receipts.get(hash) ?? null;
  gasWalletAddress = (): string => "0x00000000000000000000000000000000000000aa";
  sendNativeFromGasWallet = async (i: { chain: string; to: string; value: bigint }): Promise<string> => {
    if (this.sendFails) throw new Error("rpc down");
    if (this.sendRefused) throw Object.assign(new Error("insufficient funds"), { refused: true });
    this.sentNative.push(i);
    return `0xdrop${this.sentNative.length}`;
  };
  verifyContractSignature = async (input: { chain: string; address: string }): Promise<boolean> => {
    this.calls.push({ chain: input.chain, address: input.address });
    if (this.onCall) await this.onCall();
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.behavior === "unavailable") throw createHttpError(503, "rpc down", { code: "VERIFIER_UNAVAILABLE" });
    return this.behavior === "valid";
  };
}

class FakeSolanaRpc {
  behavior: "ok" | "unavailable" = "ok";
  /** Decimals returned while behavior is "ok"; null = not a mint. */
  decimals: number | null = 6;
  calls: string[] = [];
  getMintDecimals = async (mint: string): Promise<number | null> => {
    this.calls.push(mint);
    if (this.behavior === "unavailable") throw createHttpError(503, "rpc down", { code: "VERIFIER_UNAVAILABLE" });
    return this.decimals;
  };
}

class FakeCoinMarketCap {
  /** Quotes by CoinMarketCap id; ids not in here are missing from the response. */
  quotes = new Map<string, { value: string; observedAt: string }>();
  calls: string[][] = [];
  fail = false;
  fetchQuotes = async (ids: string[]): Promise<Map<string, { value: string; observedAt: string }>> => {
    this.calls.push(ids);
    if (this.fail) throw new Error("coinmarketcap down");
    return new Map(ids.flatMap((id) => (this.quotes.has(id) ? [[id, this.quotes.get(id)!] as const] : [])));
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
  membership: Array<{ kind: string; to: string; data: { organizationName?: string | null; role?: string; message?: string | null }; idempotencyKey: string }> = [];
  sendMembership = async (kind: string, to: string, data: { organizationName?: string | null; role?: string; message?: string | null }, idempotencyKey: string): Promise<void> => {
    this.membership.push({ kind, to, data, idempotencyKey });
  };
  basket: Array<{ kind: string; to: string; data: { basketName?: string | null; message?: string | null; decision?: string }; idempotencyKey: string }> = [];
  sendBasket = async (kind: string, to: string, data: { basketName?: string | null; message?: string | null; decision?: string }, idempotencyKey: string): Promise<void> => {
    this.basket.push({ kind, to, data, idempotencyKey });
  };
  profile: Array<{ kind: string; to: string; data: { message?: string | null }; idempotencyKey: string }> = [];
  sendProfile = async (kind: string, to: string, data: { message?: string | null }, idempotencyKey: string): Promise<void> => { this.profile.push({ kind, to, data, idempotencyKey }); };
  sendOtp = async (to: string, code: string, verificationId: string): Promise<void> => {
    if (this.fail) throw deliveryFailure("resend down");
    this.sent.push({ to, code, verificationId });
  };
}

/** A 768-d unit vector along axis `i`: cosine distance 0 to itself, 1 to any other axis. */
export const unitVector = (i: number): number[] => Array.from({ length: 768 }, (_, k) => (k === i ? 1 : 0));

class FakeGemini {
  /** What geminiSearchCall does: drive runTool like the real call (default: the model returns no call). */
  search: (query: string, runTool: (args: unknown) => Promise<Record<string, unknown>>) => Promise<unknown> = async () => null;
  embedFails = false;
  vector: number[] = unitVector(0);
  searchCalls: string[] = [];
  embedCalls: string[] = [];
  geminiSearchCall = async (query: string, runTool: (args: unknown) => Promise<Record<string, unknown>>) => { this.searchCalls.push(query); return this.search(query, runTool); };
  embedText = async (text: string): Promise<number[]> => {
    this.embedCalls.push(text);
    if (this.embedFails) throw new Error("embedding down");
    return this.vector;
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

/** Records jobs instead of adding them to Redis. */
class FakeQueue {
  jobs: Array<{ name: string; data: Record<string, unknown> }> = [];
  enqueue = async (name: string, data: Record<string, unknown>): Promise<void> => { this.jobs.push({ name, data }); };
}

export const fakes = { queue: new FakeQueue(), gemini: new FakeGemini(), evm: new FakeEvmRpc(), solana: new FakeSolanaRpc(), cmc: new FakeCoinMarketCap(), email: new FakeEmail(), sms: new FakeSms(), r2: new FakeR2() };

export function resetFakes(): void {
  Object.assign(fakes.evm, { behavior: "invalid", delayMs: 0, onCall: null, calls: [], tokenBehavior: "ok", token: { decimals: 18, symbol: "TKN", name: "Token" }, tokenCalls: [], balances: new Map(), transactions: new Map(), receipts: new Map(), nativeReceived: new Map(), sentNative: [], sendFails: false, sendRefused: false });
  Object.assign(fakes.solana, { behavior: "ok", decimals: 6, calls: [] });
  fakes.queue.jobs = [];
  Object.assign(fakes.gemini, { search: async () => null, embedFails: false, vector: unitVector(0), searchCalls: [], embedCalls: [] });
  Object.assign(fakes.cmc, { quotes: new Map(), calls: [], fail: false });
  Object.assign(fakes.email, { sent: [], application: [], organization: [], membership: [], basket: [], profile: [], fail: false });
  fakes.r2.objects.clear();
  fakes.r2.signed = [];
  Object.assign(fakes.sms, { started: [], approveCode: "123456", fail: false, checkFail: false });
}
