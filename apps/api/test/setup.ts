import { vi } from "vitest";

// Third-party providers are replaced by in-memory fakes; tests drive them through `fakes`.
vi.mock("../src/providers/resend", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { sendOtpEmail: fakes.email.sendOtp };
});
vi.mock("../src/providers/twilio", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { startSmsVerification: fakes.sms.start, checkSmsVerification: fakes.sms.check };
});
vi.mock("../src/providers/evm-rpc", async () => {
  const { fakes } = await import("./helpers/fakes");
  return { verifyContractSignature: fakes.evm.verifyContractSignature };
});
