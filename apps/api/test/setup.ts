import { vi } from "vitest";

// Third-party providers are replaced by in-memory fakes; tests drive them through `fakes`.
vi.mock("../src/providers/resend", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { sendOtpEmail: fakes.email.sendOtp, sendApplicationEmail: fakes.email.sendApplication, sendOrganizationEmail: fakes.email.sendOrganization, sendMembershipEmail: fakes.email.sendMembership, sendBasketEmail: fakes.email.sendBasket, sendProfileEmail: fakes.email.sendProfile };
});
vi.mock("../src/providers/twilio", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { startSmsVerification: fakes.sms.start, checkSmsVerification: fakes.sms.check };
});
vi.mock("../src/providers/evm-rpc", async () => {
  const { fakes } = await import("./helpers/fakes");
  return {
    verifyContractSignature: fakes.evm.verifyContractSignature, readTokenMetadata: fakes.evm.readTokenMetadata, evmBalance: fakes.evm.evmBalance, evmTransaction: fakes.evm.evmTransaction,
    evmReceipt: fakes.evm.evmReceipt, gasWalletAddress: fakes.evm.gasWalletAddress, sendNativeFromGasWallet: fakes.evm.sendNativeFromGasWallet,
  };
});
vi.mock("../src/providers/solana-rpc", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { getMintDecimals: fakes.solana.getMintDecimals };
});
vi.mock("../src/providers/coinmarketcap", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { fetchQuotes: fakes.cmc.fetchQuotes };
});
vi.mock("../src/queues", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { queues: {}, enqueue: fakes.queue.enqueue };
});
vi.mock("../src/providers/gemini", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { embedText: fakes.gemini.embedText, geminiSearchCall: fakes.gemini.geminiSearchCall };
});
vi.mock("../src/providers/r2", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { r2: { send: fakes.r2.send }, R2_BUCKET: "bytesac-test" };
});
vi.mock("@aws-sdk/s3-request-presigner", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { getSignedUrl: fakes.r2.getSignedUrl };
});
