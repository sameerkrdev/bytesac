import { ApiError } from "@repo/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { api } from "@/lib/api";
import { apiMock, renderWithClient, resetApi } from "./helpers";
import { id, leg, operation } from "./fixtures";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: require("./helpers").apiMock() }));
const mockSigner = { signSolana: jest.fn(), sendEvm: jest.fn() };
jest.mock("@/lib/wallet/use-signer", () => ({ useSigner: () => mockSigner }));
const mockApi = api as unknown as ReturnType<typeof apiMock>;

const quote = (over: Record<string, unknown> = {}) => ({
  legId: id(11), estimatedOut: "331000000", minOut: "325000000", quoteExpiresAt: null,
  transaction: { kind: "solana", serializedBase64: "AAAA" }, approval: null, gasDrop: null, ...over,
});
const wizard = () => renderWithClient(<InvestWizard basketId={id(2)} name="Alpha Basket" minimumUsdc="50" incrementUsdc="10" />);

async function toSigning() {
  await wizard();
  await fireEvent.press(screen.getByRole("button", { name: "Get preview" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Continue to signing" }));
}

describe("Invest wizard (mobile)", () => {
  beforeEach(() => {
    jest.clearAllMocks(); resetApi(mockApi); mockSigner.signSolana.mockReset(); mockSigner.sendEvm.mockReset();
    mockApi.me.mockResolvedValue({});
    mockApi.investPlan.mockResolvedValue(operation());
    mockApi.getOperation.mockResolvedValue(operation());
    jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });

  it("validates the amount before any plan is requested", async () => {
    await wizard();
    await fireEvent.changeText(screen.getByLabelText("Amount (USDC on Solana)"), "55");
    expect(screen.getByText("The amount must be a multiple of 10 USDC.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Get preview" })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText("Amount (USDC on Solana)"), "60");
    expect(screen.getByRole("button", { name: "Get preview" })).toBeEnabled();
    expect(mockApi.investPlan).not.toHaveBeenCalled();
  });

  it("previews fees, route fees, minimum out and price impact from the server before any wallet prompt", async () => {
    await wizard();
    await fireEvent.press(screen.getByRole("button", { name: "Get preview" }));
    expect(await screen.findByText("Platform fee")).toBeOnTheScreen();
    expect(mockApi.investPlan).toHaveBeenCalledWith({ basketId: id(2), amountUsdc: "50", slippageBps: 100, idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(screen.getByText("Waived — the manager has no verified payout wallet")).toBeOnTheScreen();
    expect(screen.getByText("Total fees")).toBeOnTheScreen();
    expect(screen.getByText(/Route fees \(LI.FI, DEX, bridge\): \$0.12/)).toBeOnTheScreen();
    expect(screen.getByText("Price impact 1.23%")).toBeOnTheScreen();
    expect(screen.getByText(/\(at least 0.32 SOL\)/)).toBeOnTheScreen();
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
    expect(mockApi.quoteLeg).not.toHaveBeenCalled();
  });

  it("Back cancels the unsigned plan", async () => {
    mockApi.cancelOperation.mockResolvedValue(operation({ status: "CANCELLED" }));
    await wizard();
    await fireEvent.press(screen.getByRole("button", { name: "Get preview" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(mockApi.cancelOperation).toHaveBeenCalledWith(id(1)));
    expect(await screen.findByRole("button", { name: "Get preview" })).toBeOnTheScreen();
  });

  it("shows the fresh quote and opens the wallet only after an explicit Approve tap", async () => {
    mockApi.quoteLeg.mockResolvedValue(quote());
    mockSigner.signSolana.mockResolvedValue("signed64");
    const done = operation({ status: "COMPLETED", legs: [leg({ status: "SETTLED" })] });
    mockApi.submitLeg.mockImplementation(async () => { mockApi.getOperation.mockResolvedValue(done); return done; });
    await toSigning();
    await fireEvent.press(await screen.findByRole("button", { name: "Review step 1" }));
    expect(await screen.findByText("Fresh quote for step 1")).toBeOnTheScreen();
    expect(screen.getByText(/50 USDC → about 0.331 SOL \(at least 0.325 SOL\)/)).toBeOnTheScreen();
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
    expect(mockApi.submitLeg).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Approve step 1 in your wallet" }));
    await waitFor(() => expect(mockApi.submitLeg).toHaveBeenCalledWith(id(1), id(11), { signedTx: "signed64" }));
    expect(mockSigner.signSolana).toHaveBeenCalledWith("AAAA");
    expect(await screen.findByText(/All steps are settled/)).toBeOnTheScreen();
  });

  it("declining the fresh quote signs nothing", async () => {
    mockApi.quoteLeg.mockResolvedValue(quote());
    await toSigning();
    await fireEvent.press(await screen.findByRole("button", { name: "Review step 1" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("button", { name: "Review step 1" })).toBeOnTheScreen();
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
    expect(mockApi.submitLeg).not.toHaveBeenCalled();
  });

  it("an expired quote asks for a new one and never auto-retries", async () => {
    mockApi.quoteLeg.mockResolvedValue(quote());
    mockSigner.signSolana.mockResolvedValue("signed64");
    mockApi.submitLeg.mockRejectedValue(new ApiError("QUOTE_EXPIRED", 409, "expired"));
    await toSigning();
    await fireEvent.press(await screen.findByRole("button", { name: "Review step 1" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    expect(await screen.findByText("Quote expired")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Get a new quote" })).toBeOnTheScreen();
    expect(mockApi.submitLeg).toHaveBeenCalledTimes(1);
    expect(mockSigner.signSolana).toHaveBeenCalledTimes(1);
  });

  it("a Bitcoin-spending leg is continued on the web: no quote, no wallet", async () => {
    const btc = operation({ legs: [leg({ fromChain: "bitcoin" })] });
    mockApi.investPlan.mockResolvedValue(btc);
    mockApi.getOperation.mockResolvedValue(btc);
    await toSigning();
    expect(screen.queryByRole("button", { name: "Review step 1" })).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Continue on web" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/portfolio#operation-${id(1)}$`)));
    expect(mockApi.quoteLeg).not.toHaveBeenCalled();
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
  });

  it("a Bitcoin transaction from the server without signPsbt ends in the web handoff, nothing signed", async () => {
    mockApi.quoteLeg.mockResolvedValue(quote({ transaction: { kind: "bitcoin", psbtBase64: "cHNidA==", inputCount: 1 } }));
    await toSigning();
    await fireEvent.press(await screen.findByRole("button", { name: "Review step 1" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Approve step 1 in your wallet" }));
    expect(await screen.findByRole("button", { name: "Continue on web" })).toBeOnTheScreen();
    expect(mockSigner.signSolana).not.toHaveBeenCalled();
    expect(mockApi.submitLeg).not.toHaveBeenCalled();
  });

  it("a missing declaration shows the declaration form instead of an error", async () => {
    mockApi.investPlan.mockRejectedValue(new ApiError("DECLARATION_REQUIRED", 403, "declare"));
    await wizard();
    await fireEvent.press(screen.getByRole("button", { name: "Get preview" }));
    expect(await screen.findByRole("button", { name: "Save declaration" })).toBeOnTheScreen();
  });
});
