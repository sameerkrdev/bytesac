import { beforeEach, vi } from "vitest";

// No test reaches a real network: fetch fails like an outage unless a test stubs it (the stub is dropped again by `vi.unstubAllGlobals()`).
beforeEach(() => {
  vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed (network disabled in tests)"); });
});

// Third-party providers are replaced by in-memory fakes; tests drive them through `fakes`.
vi.mock("@/providers/resend", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { sendOtpEmail: fakes.email.sendOtp, sendApplicationEmail: fakes.email.sendApplication, sendOrganizationEmail: fakes.email.sendOrganization, sendMembershipEmail: fakes.email.sendMembership, sendBasketEmail: fakes.email.sendBasket, sendProfileEmail: fakes.email.sendProfile, sendNotificationEmail: fakes.email.sendNotification };
});
vi.mock("@/providers/fcm", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { sendPush: fakes.fcm.sendPush };
});
vi.mock("@/providers/twilio", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { startSmsVerification: fakes.sms.start, checkSmsVerification: fakes.sms.check };
});
vi.mock("@/providers/evm-rpc", async () => {
  const { fakes } = await import("./helpers/fakes");
  return {
    verifyContractSignature: fakes.evm.verifyContractSignature, readTokenMetadata: fakes.evm.readTokenMetadata, evmBalance: fakes.evm.evmBalance, evmTransaction: fakes.evm.evmTransaction,
    evmReceipt: fakes.evm.evmReceipt, gasWalletAddress: fakes.evm.gasWalletAddress, sendNativeFromGasWallet: fakes.evm.sendNativeFromGasWallet,
    evmNativeReceived: fakes.evm.evmNativeReceived, evmCode: fakes.evm.evmCode,
  };
});
vi.mock("@/providers/solana-rpc", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { getMintDecimals: fakes.solana.getMintDecimals };
});
vi.mock("@/providers/coinmarketcap", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { fetchQuotes: fakes.cmc.fetchQuotes };
});
vi.mock("@/config/queues", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { queues: {}, enqueue: fakes.queue.enqueue };
});
vi.mock("@/providers/gemini", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { embedText: fakes.gemini.embedText, geminiSearchCall: fakes.gemini.geminiSearchCall };
});
vi.mock("@/providers/r2", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { r2: { send: fakes.r2.send }, R2_BUCKET: "bytesac-test" };
});
vi.mock("@aws-sdk/s3-request-presigner", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { getSignedUrl: fakes.r2.getSignedUrl };
});
